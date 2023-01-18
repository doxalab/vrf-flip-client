import { initializeApp } from "firebase/app";
import { getFirestore } from "@firebase/firestore";
const firebaseConfig = {
    apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
    authDomain: "vrf-flip.firebaseapp.com",
    projectId: "vrf-flip",
    storageBucket: "vrf-flip.appspot.com",
    messagingSenderId: "1063055223728",
    appId: "1:1063055223728:web:38803fe53ff71fd2eb8475",
    measurementId: "G-LGB1JX27YM",
  };
  
  // Initialize Firebase
  const app = initializeApp(firebaseConfig);
  export const db = getFirestore(app);