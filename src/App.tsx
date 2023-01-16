import {
  clusterApiUrl,
  ConfirmOptions,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import React, { useState, useRef, useEffect, FormEvent } from "react";
import { Button, Header, Segment } from "semantic-ui-react";
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
import { Program } from "@project-serum/anchor";
import { PROGRAM_ID_CLI } from "./generated/programId";

const connection = new Connection(clusterApiUrl("devnet"));
var Buffer = require("buffer/").Buffer;
const DEFAULT_COMMITMENT = "confirmed";
const ops = "processed";

function App() {
  const [wallet, setWallet] = useState<string>("");
  const [isConnected, setIsConnected] = useState<boolean>(false);

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
        // await createAccount(response.publicKey.toString());
      } catch (error) {
        const response = await solana.connect();
        console.log(response.publicKey.toString());
        setWallet(response.publicKey.toString());
        setIsConnected(true);
        // await createAccount(response.publicKey.toString());
      }
    }
  };

  useEffect(() => {
    const onLoad = async () => {
      await checkSolanaWalletExists();
    };
    checkSolanaWalletExists();
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);

  const getProvider = () => {
    const provider = new anchor.AnchorProvider(
      connection,
      window.solana,
      { commitment: ops }
    );
    return provider;
  };

  async function getFlipProgram(rpcEndpoint: string) {
    const programId = new anchor.web3.PublicKey(PROGRAM_ID_CLI);
    const provider = new anchor.AnchorProvider(
      new anchor.web3.Connection(rpcEndpoint, {
        commitment: DEFAULT_COMMITMENT,
      }),
      new AnchorWallet(anchor.web3.Keypair.generate()),
      { commitment: DEFAULT_COMMITMENT }
    );

    const idl = await anchor.Program.fetchIdl(programId, provider);
    if (!idl)
      throw new Error(
        `Failed to find IDL for program [ ${programId.toBase58()} ]`
      );

    return new anchor.Program(
      idl,
      programId,
      provider,
      new anchor.BorshCoder(idl)
    );
  }

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
    const payerPubkey = new PublicKey(pubkey);
    const provider = getProvider();
    const switchboardProgram = await loadSwitchboardProgram(
      "devnet",
      provider.connection,
    );
    // const house = await House.load(program);
    // const program = await getFlipProgram(clusterApiUrl("devnet"));
    const programID = new PublicKey(idl.metadata.address);
    const program = new anchor.Program(JSON.parse(JSON.stringify(idl)), programID, provider);

    // const program = await anchor.

    const switchboardQueue = getQueueAccount(switchboardProgram);
    const switchboardMint = await switchboardQueue.loadMint();

    const vrfSecret = anchor.web3.Keypair.generate();

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
          authority: payerPubkey,
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
      // create user account
      // await program.methods
      //   .userInit({
      //     switchboardStateBump: stateBump,
      //     vrfPermissionBump: permissionBump,
      //   })
      //   .accounts({
      //     user: userKey,
      //     house: house.publicKey,
      //     mint: flipMint.address,
      //     authority: payerPubkey,
      //     escrow: escrowKeypair.publicKey,
      //     rewardAddress: rewardAddress,
      //     vrf: vrfSecret.publicKey,
      //     payer: payerPubkey,
      //     systemProgram: anchor.web3.SystemProgram.programId,
      //     tokenProgram: spl.TOKEN_PROGRAM_ID,
      //     associatedTokenProgram: spl.ASSOCIATED_TOKEN_PROGRAM_ID,
      //     rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      //   })
      //   .instruction(),
    ];
    const tx = new anchor.web3.Transaction().add(...txnIxns)
    tx.feePayer = payerPubkey;
    tx.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;

    const {signature} = await phantomProvider.signAndSendTransaction(tx);
    console.log(signature);
    const status = await connection.getSignatureStatus(signature);
    console.log(status);
    console.log("over");
  };

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
          <Button primary onClick={() => createAccount(wallet)}>Initialize User</Button>
        </Segment>
      </div>
    </div>
  );
}

export default App;
