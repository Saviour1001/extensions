// Import necessary functions and constants from the Solana web3.js and SPL Token packages
import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  TransactionSignature,
  SignatureStatus,
  TransactionConfirmationStatus,
  PublicKey,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createInitializeMintInstruction,
  mintTo,
  createAssociatedTokenAccountIdempotent,
  AuthorityType,
  createInitializeMetadataPointerInstruction,
  TYPE_SIZE,
  LENGTH_SIZE,
  getMintLen,
  ExtensionType,
  getMint,
  getMetadataPointerState,
  getTokenMetadata,
  createSetAuthorityInstruction,
} from "@solana/spl-token";
import {
  createInitializeInstruction,
  createUpdateFieldInstruction,
  createRemoveKeyInstruction,
  pack,
  TokenMetadata,
} from "@solana/spl-token-metadata";
import bs58 from "bs58";

// Configuration
const CONFIG = {
  // Network
  RPC_ENDPOINT: "https://staging-rpc.dev2.eclipsenetwork.xyz",
  PRIVATE_KEY:
    "5wa525ff1GscXh3t6Ky3Bhh8UE38F3dFxkxXRkKheAAs4rUwh6ot3tXFAYaxZ9mZM1Q32gWkJA3Hg2tAT5QziiMi",

  // Token Settings
  DECIMALS: 0, // keep 0 for NFTs
  MINT_AMOUNT: 500,
  RECEIVER_ADDRESS: "5TJQVLar32DYk1BrTRnhVSbC2vKgcNL57kSwkb5XWr1K",

  // NFT Metadata
  NFT_METADATA: {
    name: "Mark 1",
    symbol: "MARK1",
    uri: "https://uploader.irys.xyz/8LMagECpDj42eX6YrWFQ8r2F3VMt49yjoHwFdrs6nkCT",
    additionalMetadata: [
      ["Background", "Blue"],
      ["Coolness", "100"],
      ["Sarcasm", "100"],
    ],
  },
};

const wallet = Keypair.fromSecretKey(bs58.decode(CONFIG.PRIVATE_KEY));

console.log("Wallet public key: ", wallet.publicKey.toBase58());

const connection = new Connection(CONFIG.RPC_ENDPOINT, "confirmed");

const payer = wallet;
const authority = wallet;
const owner = wallet;
const mintKeypair = Keypair.generate();
const mint = mintKeypair.publicKey;

// NFT Metadata
const tokenMetadata: TokenMetadata = {
  updateAuthority: new PublicKey(CONFIG.RECEIVER_ADDRESS),
  mint: mint,
  name: CONFIG.NFT_METADATA.name,
  symbol: CONFIG.NFT_METADATA.symbol,
  uri: CONFIG.NFT_METADATA.uri,
  additionalMetadata: CONFIG.NFT_METADATA.additionalMetadata,
};

function generateExplorerUrl(
  identifier: string,
  isAddress: boolean = false
): string {
  if (!identifier) return "";
  const baseUrl = "https://eclipsescan.xyz";
  const localSuffix = "?cluster=devnet";
  const slug = isAddress ? "account" : "tx";
  return `${baseUrl}/${slug}/${identifier}${localSuffix}`;
}

async function airdropLamports() {
  const airdropSignature = await connection.requestAirdrop(
    payer.publicKey,
    2 * LAMPORTS_PER_SOL
  );
  await connection.confirmTransaction({
    signature: airdropSignature,
    ...(await connection.getLatestBlockhash()),
  });

  console.log("Airdrop complete");
}

async function main() {
  try {
    console.log("Starting NFT creation process");
    console.log("Airdropping lamports");
    await airdropLamports();

    // 1. Create Token and Mint
    console.log("Creating token and mint");
    const [initSig, mintSig] = await createTokenAndMint();
    console.log(`Token created and minted:`);
    console.log(`   ${generateExplorerUrl(initSig)}`);
    console.log(`   ${generateExplorerUrl(mintSig)}`);
    // Log New NFT
    console.log(`New NFT:`);
    console.log(`   ${generateExplorerUrl(mint.toBase58(), true)}`);

    // 2. Remove Token Authority
    console.log("Removing token authority");
    const removeSig = await removeTokenAuthority();
    console.log(`Token authority removed:`);
    console.log(`   ${generateExplorerUrl(removeSig)}`);
  } catch (err) {
    console.error(err);
  }
}

async function createTokenAndMint(): Promise<[string, string]> {
  // Calculate the minimum balance for the mint account
  const mintLen = getMintLen([ExtensionType.MetadataPointer]);
  const metadataLen = TYPE_SIZE + LENGTH_SIZE + pack(tokenMetadata).length;
  const mintLamports = await connection.getMinimumBalanceForRentExemption(
    mintLen + metadataLen
  );

  console.log("params", mintLen, metadataLen, mintLamports);

  // Prepare transaction
  const transaction = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint,
      space: mintLen,
      lamports: mintLamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeMetadataPointerInstruction(
      mint,
      authority.publicKey,
      mint,
      TOKEN_2022_PROGRAM_ID
    ),
    createInitializeMintInstruction(
      mint,
      CONFIG.DECIMALS,
      authority.publicKey,
      null,
      TOKEN_2022_PROGRAM_ID
    ),
    createInitializeInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      metadata: mint,
      updateAuthority: authority.publicKey,
      mint: mint,
      mintAuthority: authority.publicKey,
      name: tokenMetadata.name,
      symbol: tokenMetadata.symbol,
      uri: tokenMetadata.uri,
    }),
    createUpdateFieldInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      metadata: mint,
      updateAuthority: authority.publicKey,
      field: tokenMetadata.additionalMetadata[0][0],
      value: tokenMetadata.additionalMetadata[0][1],
    })
  );

  // Initialize NFT with metadata
  const initSig = await sendAndConfirmTransaction(connection, transaction, [
    payer,
    mintKeypair,
    authority,
  ]);

  console.log("Init Signature", initSig);

  // Create associated token account
  const sourceAccount = await createAssociatedTokenAccountIdempotent(
    connection,
    payer,
    mint,
    owner.publicKey,
    {},
    TOKEN_2022_PROGRAM_ID
  );

  // Mint NFT to associated token account
  const mintSig = await mintTo(
    connection,
    payer,
    mint,
    sourceAccount,
    authority,
    CONFIG.MINT_AMOUNT,
    [],
    undefined,
    TOKEN_2022_PROGRAM_ID
  );

  return [initSig, mintSig];
}

async function removeTokenAuthority(): Promise<string> {
  const transaction = new Transaction().add(
    createSetAuthorityInstruction(
      mint,
      authority.publicKey,
      AuthorityType.MintTokens,
      new PublicKey(CONFIG.RECEIVER_ADDRESS),
      [],
      TOKEN_2022_PROGRAM_ID
    )
  );
  return await sendAndConfirmTransaction(connection, transaction, [
    payer,
    authority,
  ]);
}

main();
