import {
  clusterApiUrl,
  ConfirmOptions,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import React, { useState, useRef, useEffect, FormEvent } from "react";
import { Button, Card, Header, Segment } from "semantic-ui-react";
import Startbar from "./Startbar";
import * as spl from "@solana/spl-token-v3";
import * as anchor from "@project-serum/anchor";
import {
  AnchorWallet,
  loadSwitchboardProgram,
  OracleQueueAccount,
  PermissionAccount,
  ProgramStateAccount,
  SwitchboardProgram,
  VrfAccount,
} from "@switchboard-xyz/switchboard-v2";
import idl from "./idl.json";
import { collection, getDocs, addDoc } from "@firebase/firestore";
import { db } from "./firebase-config";
import { GameStateFields } from "./generated/accounts/GameState";

const connection = new Connection(clusterApiUrl("devnet"));
var Buffer = require("buffer/").Buffer;
const DEFAULT_COMMITMENT = "confirmed";
const ops = "confirmed";

function App() {
  const [wallet, setWallet] = useState<string>("");
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [gameSecretId, setGameSecretId] = useState("");
  const [vrfSecretKey, setVrfSecretKey] = useState<PublicKey>();
  const [loading, setLoading] = useState<boolean>(false);
  const [randomValue, setRandomValue] = useState<string>("");
  const [userInitialized, setUserInitialized] = useState<boolean>(false);
  const [games, setGames] = useState<Array<any>>([]);
  const [gameIds, setGameIds] = useState<Array<string>>([]);

  // Firestore collection ref
  const gameCollectionRef = collection(db, "games");

  const getPhantomProvider = () => {
    if ("phantom" in window) {
      const provider = window.phantom?.solana;

      if (provider?.isPhantom) {
        return provider;
      }
    }

    window.open("https://phantom.app/", "_blank");
  };

  const phantomProvider = getPhantomProvider();

  useEffect(() => {
    phantomProvider.on("accountChanged", (pubkey: any) => {
      if (pubkey) {
        console.log(pubkey.toBase58());
        setWallet(pubkey);
        setIsConnected(true);
      } else {
        console.log("some error occured");
      }
    });
  }, [phantomProvider]);

  const checkSolanaWalletExists = async () => {
    const { solana } = window;
    if (solana && solana.isPhantom) {
      try {
        const response = await solana.connect({ onlyIfTrusted: true });
        console.log(response.publicKey.toString());
        setWallet(response.publicKey.toString());
        setIsConnected(true);
        findUserInitialized(response.publicKey.toString());
      } catch (error) {
        const response = await solana.connect();
        console.log(response.publicKey.toString());
        setWallet(response.publicKey.toString());
        setIsConnected(true);
        findUserInitialized(response.publicKey.toString());
      }
    }
  };

  const fetchGames = async () => {
    const data = await getDocs(gameCollectionRef);
    const program = getProgram();
    let gamePDAs: Array<PublicKey> = [];
    let gameIds: Array<string> = [];
    data.docs.forEach((doc) => {
      gamePDAs.push(new PublicKey(doc.get("game_pda")));
      gameIds.push(doc.get("game_id"));
    });
    const gameDetails: any = await program.account.gameState.fetchMultiple(
      gamePDAs
    );
    setGames(gameDetails);
    setGameIds(gameIds);
    console.log(gameDetails);
  };

  useEffect(() => {
    const onLoad = async () => {
      await checkSolanaWalletExists();
    };
    checkSolanaWalletExists();
    fetchGames();
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);

  const getProvider = () => {
    const provider = new anchor.AnchorProvider(connection, window.solana, {
      commitment: ops,
    });
    return provider;
  };

  const getProgram = () => {
    const provider = getProvider();
    const programID = new PublicKey(idl.metadata.address);
    // console.log(programID.toBase58());
    const program = new anchor.Program(
      JSON.parse(JSON.stringify(idl)),
      programID,
      provider
    );
    return program;
  };

  const findUserInitialized = async (wallet: string) => {
    const pubKey = new PublicKey(wallet);
    const program = getProgram();
    const [userVRF, setUserVRF] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("VRFGAME"), pubKey.toBuffer()],
      program.programId
    );
    try {
      const state: any = await program.account.vrfKey.fetch(userVRF);
      setUserInitialized(true);
      console.log(state.key.toBase58());
      setVrfSecretKey(state.key);
    } catch (error) {
      console.log(error);
      console.log("User is not initialized");
      setUserInitialized(false);
    }
  };

  async function getCallback(
    program: anchor.Program,
    vrfClientKey: PublicKey,
    vrfSecret: PublicKey
  ) {
    const ixnCoder = new anchor.BorshInstructionCoder(program.idl);
    const callback = {
      programId: program.programId,
      ixData: ixnCoder.encode("consumeRandomness", ""),
      accounts: [
        { pubkey: vrfClientKey, isSigner: false, isWritable: true },
        { pubkey: vrfSecret, isSigner: false, isWritable: false },
      ],
    };
    return callback;
  }
  function getQueueAccount(
    switchboardProgram: SwitchboardProgram
  ): OracleQueueAccount {
    const queueAccount = new OracleQueueAccount({
      program: switchboardProgram as any,
      publicKey: new PublicKey("F8ce7MsckeZAbAGmxjJNetxYXQa9mKr9nnrC3qKubyYy"),
    });
    return queueAccount;
  }

  const createAccount = async (pubkey: string) => {
    console.log("in here");
    console.log(pubkey);
    // if (userInitialized) {
    //   console.log("User has already initialized");
    //   return;
    // }
    const payerPubkey = new PublicKey(pubkey);
    const provider = getProvider();
    const switchboardProgram = await loadSwitchboardProgram(
      "devnet",
      provider.connection
    );
    const program = getProgram();
    console.log(`This is programID: ${program.programId.toBase58()}`);

    const switchboardQueue = getQueueAccount(switchboardProgram);
    const switchboardMint = await switchboardQueue.loadMint();

    const vrfSecret = anchor.web3.Keypair.generate();
    setVrfSecretKey(vrfSecret.publicKey);

    const [programStateAccount, stateBump] = ProgramStateAccount.fromSeed(
      switchboardProgram as any
    );

    const queue = await switchboardQueue.loadData();
    const [vrfClientKey, vrfClientBump] =
      anchor.utils.publicKey.findProgramAddressSync(
        [Buffer.from("CLIENTSEED"), vrfSecret.publicKey.toBytes()],
        program.programId
      );

    const callback = await getCallback(
      program,
      vrfClientKey,
      vrfSecret.publicKey
    );

    const [permissionAccount, permissionBump] = PermissionAccount.fromSeed(
      switchboardProgram as any,
      queue.authority,
      switchboardQueue.publicKey,
      vrfSecret.publicKey
    );

    const vrfEscrow = await spl.getAssociatedTokenAddress(
      switchboardMint.address,
      vrfSecret.publicKey,
      true
    );

    const [userVRF, setUserVRF] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("VRFGAME"), payerPubkey.toBuffer()],
      program.programId
    );

    const txnIxns: TransactionInstruction[] = [
      // create VRF account
      spl.createAssociatedTokenAccountInstruction(
        payerPubkey,
        vrfEscrow,
        vrfSecret.publicKey,
        switchboardMint.address
      ),
      spl.createSetAuthorityInstruction(
        vrfEscrow,
        vrfSecret.publicKey,
        spl.AuthorityType.AccountOwner,
        programStateAccount.publicKey
      ),
      anchor.web3.SystemProgram.createAccount({
        fromPubkey: payerPubkey,
        newAccountPubkey: vrfSecret.publicKey,
        space: switchboardProgram.account.vrfAccountData.size,
        lamports:
          await program.provider.connection.getMinimumBalanceForRentExemption(
            switchboardProgram.account.vrfAccountData.size
          ),
        programId: switchboardProgram.programId,
      }),
      await switchboardProgram.methods
        .vrfInit({
          stateBump,
          callback: callback,
        })
        .accounts({
          vrf: vrfSecret.publicKey,
          escrow: vrfEscrow,
          authority: vrfClientKey,
          oracleQueue: switchboardQueue.publicKey,
          programState: programStateAccount.publicKey,
          tokenProgram: spl.TOKEN_PROGRAM_ID,
        })
        .instruction(),
      // create permission account
      await switchboardProgram.methods
        .permissionInit({})
        .accounts({
          permission: permissionAccount.publicKey,
          authority: queue.authority,
          granter: switchboardQueue.publicKey,
          grantee: vrfSecret.publicKey,
          payer: payerPubkey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .instruction(),
      await program.methods
        .initVrf({})
        .accounts({
          state: userVRF,
          vrf: vrfSecret.publicKey,
          payer: payerPubkey,
          vrfState: vrfClientKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .instruction(),
    ];
    const tx = new anchor.web3.Transaction().add(...txnIxns);
    tx.feePayer = payerPubkey;
    tx.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;
    tx.sign(vrfSecret);

    const { signature } = await phantomProvider.signAndSendTransaction(tx);
    const status = await connection.getSignatureStatus(signature);
    console.log(status);
    console.log("over");
  };

  const findPDA = async () => {
    const provider = getProvider();
    const programID = new PublicKey(idl.metadata.address);
    const program = new anchor.Program(
      JSON.parse(JSON.stringify(idl)),
      programID,
      provider
    );
    const PDA = new PublicKey("98VHjjMorYDeVXxUdUDXLyb6dDcZKjpxTPFAxW8xpfXb");
    const [vrfClientKey, vrfClientBump] =
      anchor.utils.publicKey.findProgramAddressSync(
        [Buffer.from("CLIENTSEED"), vrfSecretKey!.toBytes()],
        program.programId
      );
    console.log(vrfClientKey);
    const gameState: any = await program.account.vrfClientState.fetch(
      vrfClientKey
    );
    console.log(gameState.result.toString());
  };

  const createGame = async () => {
    const program = getProgram();
    const gameId = (Math.random() * 1000).toString();
    setGameSecretId(gameId);
    const payerPubkey = new PublicKey(wallet);
    const [gamePDA, gameBump] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("GAME"), Buffer.from(gameId), payerPubkey.toBuffer()],
      program.programId
    );
    const [escrowPDA, escrowBump] =
      await anchor.web3.PublicKey.findProgramAddress(
        [Buffer.from("ESCROW"), Buffer.from(gameId), payerPubkey.toBuffer()],
        program.programId
      );
    const [vrfClientKey, vrfClientBump] =
      anchor.utils.publicKey.findProgramAddressSync(
        [Buffer.from("CLIENTSEED"), vrfSecretKey!.toBytes()],
        program.programId
      );
    console.log(vrfClientKey.toBase58());
    const USDCMint = new PublicKey(
      "DmLQYBFTMLt2DTCPA9NnC81zZwZCrYwWBNmkbYnUgo9Y"
    );
    const payerTokenAccount = await spl.getAssociatedTokenAddress(
      USDCMint,
      payerPubkey
    );
    console.log(gameId);
    try {
      const tx = await program.methods
        .initClient({
          maxResult: new anchor.BN(1337),
          gameId: gameId,
          choice: new anchor.BN(0),
          betAmount: new anchor.BN(1),
        })
        .accounts({
          game: gamePDA,
          escrowTokenAccount: escrowPDA,
          tokenMint: USDCMint,
          userTokenAccount: payerTokenAccount,
          state: vrfClientKey,
          vrf: vrfSecretKey,
          payer: payerPubkey,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: spl.TOKEN_PROGRAM_ID,
        })
        .rpc();
      console.log(tx);
      const status = await connection.getSignatureStatus(tx);
      console.log(status);
      if (status) {
        await addDoc(gameCollectionRef, {
          game_id: gameId,
          owner: wallet,
          game_pda: gamePDA.toBase58(),
        });
        console.log("Document updated");
      }
    } catch (error) {
      console.log(error);
    }
  };

  const requestRandomness = async (gameId: any) => {
    setLoading(true);
    const payerPubkey = new PublicKey(wallet);
    const provider = getProvider();
    const switchboardProgram = await loadSwitchboardProgram(
      "devnet",
      provider.connection
    );
    const program = getProgram();
    console.log(vrfSecretKey?.toBase58());
    const vrfSecret = vrfSecretKey;
    const [gamePDA, gameBump] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("GAME"), Buffer.from(gameId), payerPubkey.toBuffer()],
      program.programId
    );
    const [escrowPDA, escrowBump] =
      await anchor.web3.PublicKey.findProgramAddress(
        [Buffer.from("ESCROW"), Buffer.from(gameId), payerPubkey.toBuffer()],
        program.programId
      );

    const switchboardQueue = getQueueAccount(switchboardProgram);
    const switchboardMint = await switchboardQueue.loadMint();

    const [programStateAccount, stateBump] = ProgramStateAccount.fromSeed(
      switchboardProgram as any
    );

    const queue = await switchboardQueue.loadData();
    const [vrfClientKey, vrfClientBump] =
      anchor.utils.publicKey.findProgramAddressSync(
        [Buffer.from("CLIENTSEED"), vrfSecret!.toBytes()],
        program.programId
      );
    console.log(vrfClientKey.toBase58());

    const [permissionAccount, permissionBump] = PermissionAccount.fromSeed(
      switchboardProgram as any,
      queue.authority,
      switchboardQueue.publicKey,
      vrfSecret!
    );

    const vrfEscrow = await spl.getAssociatedTokenAddress(
      switchboardMint.address,
      vrfSecret!,
      true
    );

    const USDCMint = new PublicKey(
      "DmLQYBFTMLt2DTCPA9NnC81zZwZCrYwWBNmkbYnUgo9Y"
    );
    const payerTokenAccount = await spl.getAssociatedTokenAddress(
      USDCMint,
      payerPubkey
    );

    setGameSecretId(gameId);

    const wrappedMint = new PublicKey(
      "So11111111111111111111111111111111111111112"
    );
    const payerWrappedTokenAddress = await spl.getAssociatedTokenAddress(
      wrappedMint,
      payerPubkey
    );

    try {
      const request_signature = await program.methods
        .requestRandomness({
          switchboardStateBump: stateBump,
          permissionBump,
          gameId,
        })
        .accounts({
          state: vrfClientKey,
          vrf: vrfSecret!,
          oracleQueue: switchboardQueue.publicKey,
          queueAuthority: queue.authority,
          dataBuffer: queue.dataBuffer,
          permission: permissionAccount.publicKey,
          escrow: vrfEscrow,
          programState: programStateAccount.publicKey,
          switchboardProgram: switchboardProgram.programId,
          payerWallet: payerWrappedTokenAddress,
          payerAuthority: payerPubkey,
          escrowTokenAccount: escrowPDA,
          game: gamePDA,
          owner: payerPubkey,
          userTokenAccount: payerTokenAccount,
          joinee: payerPubkey,
          recentBlockhashes: anchor.web3.SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .rpc();

      console.log(request_signature);

      const status = await connection.getSignatureStatus(request_signature);
      const timeout = 30;
      if (status) {
        console.log(status);
        let accountWs: number;
        const awaitUpdatePromise = new Promise(
          (resolve: (value: any) => void) => {
            accountWs = program.provider.connection.onAccountChange(
              vrfClientKey,
              async (accountInfo) => {
                console.log(accountInfo);
                const vrfClientState: any =
                  await program.account.vrfClientState.fetch(vrfClientKey);
                console.log(
                  `VrfClient Result: ${vrfClientState.result.toString(10)}`
                );
                if (vrfClientState.result.toString(10) === "0") {
                  return;
                }
                setLoading(false);
                setRandomValue(vrfClientState.result.toString(10));
                resolve(vrfClientState);
                return;
              }
            );
          }
        );
        const result = await promiseWithTimeout(
          awaitUpdatePromise,
          timeout * 1000,
          new Error(`flip user failed to update in ${timeout} seconds`)
        ).finally(() => {
          if (accountWs) {
            program.provider.connection.removeAccountChangeListener(accountWs);
          }
        });
      }
    } catch (error) {
      console.log(error);
      setLoading(false);
    }
    console.log(gamePDA.toBase58());
    console.log(vrfClientKey.toBase58());
  };

  function promiseWithTimeout<T>(
    promise: Promise<T>,
    ms: number,
    timeoutError = new Error("Promise timed out")
  ): Promise<T> {
    // create a promise that rejects in milliseconds
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(timeoutError);
      }, ms);
    });

    // returns a race between timeout and the passed promise
    return Promise.race<T>([promise, timeout]);
  }

  return (
    <div>
      <Startbar />
      <br />
      <div className="content ">
        <Header as="h1" className="centerAlign">
          VRF Coin Flip
        </Header>
        <Segment>
          <Header as="h3" dividing>
            Perform Coin Flips
          </Header>
          {isConnected ? (
            <p>Wallet Connected: {wallet}</p>
          ) : (
            <p>Wallet is not connected</p>
          )}
          {userInitialized ? (
            <p>The user has initialized</p>
          ) : (
            <p>
              The user has not initialized, please initialize before requesting
              for randomness
            </p>
          )}
          <Button primary onClick={() => createAccount(wallet)}>
            Initialize User
          </Button>
          <Button onClick={createGame}>createGame</Button>
          {loading ? (
            <Button loading>requesting Randomness</Button>
          ) : (
            <Button onClick={requestRandomness}>Request Randomness</Button>
          )}
          <br />
          <br />
          <Card.Group>
            {games != null && games?.map((game, index) => {
              return (
                <Card>
                  <Card.Content>
                    <Card.Header>Game: {gameIds[index]}</Card.Header>
                    <Card.Meta>Bet Amount: {Number(game.betAmount)}</Card.Meta>
                    <Card.Meta>
                      Room Owner Choice: {game.ownerChoice ? "Heads" : "Tails"}
                    </Card.Meta>
                    {game.result != null && (
                      <Card.Description>
                        Result:{" "}
                        {Number(game.result) === 0 ? (
                          <strong>Tails</strong>
                        ) : (
                          <strong>Heads</strong>
                        )}
                      </Card.Description>
                    )}
                  </Card.Content>
                  <Card.Content extra>
                    <div className="ui two buttons">
                      {game.winner != null ? (
                        <Button basic color="red">
                          Claim
                        </Button>
                      ) : (
                        <Button
                          basic
                          color="green"
                          onClick={() =>
                            requestRandomness(gameIds[index])
                          }
                        >
                          Play
                        </Button>
                      )}
                    </div>
                  </Card.Content>
                </Card>
              );
            })}
          </Card.Group>
          {randomValue !== "" && <p>The VRF value is: {randomValue}</p>}
        </Segment>
      </div>
    </div>
  );
}

export default App;
