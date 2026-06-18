import {
  Asset,
  type BitcoinToEvmSwapResponse,
  type Chain,
} from "@lendasat/lendaswap-sdk-pure";
import { formatUsdc } from "../balance.js";
import {
  asBitcoinToEvm,
  buildClient,
  waitForAnySwapStatus,
  waitForSwapStatus,
} from "../client.js";
import { claimEvmSwap } from "./claim.js";
import { printSwapStatus } from "./status.js";

function parseSats(amount: string): bigint {
  if (!/^\d+$/.test(amount)) {
    throw new Error(
      "BTC amount must be provided in satoshis as a whole number.",
    );
  }

  const sats = BigInt(amount);
  if (sats <= 0n) {
    throw new Error("BTC amount must be greater than zero.");
  }

  return sats;
}

async function waitForBitcoinDepositProgress(
  client: Awaited<ReturnType<typeof buildClient>>,
  swapId: string,
) {
  console.log(`\nWaiting for BTC deposit...`);
  const fundingSwap = await waitForAnySwapStatus(client, swapId, [
    "clientfundingseen",
    "clientfunded",
  ]);

  if (fundingSwap.status === "clientfundingseen") {
    console.log(`BTC deposit seen in mempool. Waiting for confirmation`);

    const confirmedSwap = await waitForAnySwapStatus(client, swapId, [
      "clientfunded",
      "serverfunded",
    ]);

    if (confirmedSwap.status === "clientfunded") {
      console.log(`BTC deposit confirmed.`);
      return;
    }

    console.log(`BTC deposit confirmed and USDC already funded by server.`);
    return;
  }

  console.log(`BTC deposit confirmed.`);
}

export async function createBitcoinToUsdcSwap(
  amountSatsStr: string,
  evmAddress: string,
) {
  const client = await buildClient();
  const sourceAmount = parseSats(amountSatsStr);

  console.log(`\n--- LendaSwap: BTC On-chain -> USDC (Arbitrum) ---`);
  console.log(`BTC amount: ${sourceAmount.toString()} sats`);
  console.log(`USDC destination: ${evmAddress}`);

  console.log(`\nFetching quote...`);
  const quote = await client.getQuote({
    sourceChain: Asset.BTC_ONCHAIN.chain as Chain,
    sourceToken: Asset.BTC_ONCHAIN.tokenId,
    targetChain: Asset.USDC_ARBITRUM.chain as Chain,
    targetToken: Asset.USDC_ARBITRUM.tokenId,
    sourceAmount: Number(sourceAmount),
  });

  console.log(`\n--- Quote ---`);
  console.log(`  You send:       ${quote.source_amount} sats`);
  console.log(
    `  You receive:    ~${formatUsdc(BigInt(quote.target_amount))} USDC`,
  );
  console.log(
    `  Protocol fee:   ${quote.protocol_fee} sats (${(quote.protocol_fee_rate * 100).toFixed(2)}%)`,
  );

  if (Number(sourceAmount) < quote.min_amount) {
    console.error(`\nAmount too low. Minimum is ${quote.min_amount} sats.`);
    process.exit(1);
  }
  if (Number(sourceAmount) > quote.max_amount) {
    console.error(`\nAmount too high. Maximum is ${quote.max_amount} sats.`);
    process.exit(1);
  }

  console.log(`\nCreating swap...`);
  const result = await client.createSwap({
    source: Asset.BTC_ONCHAIN,
    target: Asset.USDC_ARBITRUM,
    sourceAmount: Number(sourceAmount),
    targetAddress: evmAddress,
  });

  const swap = result.response as BitcoinToEvmSwapResponse;
  const swapId = swap.id;

  console.log(`Swap created: ${swapId}`);
  console.log(
    `Send exactly ${swap.source_amount} sats to: ${swap.btc_htlc_address}`,
  );
  console.log(`Expected USDC: ~${formatUsdc(BigInt(swap.target_amount))} USDC`);

  await waitForBitcoinDepositProgress(client, swapId);

  console.log(`\nWaiting for USDC to be funded on Arbitrum...`);
  await waitForSwapStatus(client, swapId, "serverfunded");
  console.log(`USDC funded by server.`);

  await claimEvmSwap(client, swapId);

  const finalSwap = asBitcoinToEvm(
    await client.getSwap(swapId, { updateStorage: true }),
  );
  printSwapStatus(finalSwap);
}

export async function continueBitcoinToUsdcSwap(swapId: string) {
  const client = await buildClient();

  const swap = asBitcoinToEvm(
    await client.getSwap(swapId, { updateStorage: true }),
  );

  console.log(`\nResuming BTC -> USDC swap ${swapId}`);
  console.log(`Current status: ${swap.status}`);
  console.log(`BTC deposit address: ${swap.btc_htlc_address}`);

  switch (swap.status) {
    case "pending": {
      await waitForBitcoinDepositProgress(client, swapId);

      console.log(`\nWaiting for USDC to be funded on Arbitrum...`);
      await waitForSwapStatus(client, swapId, "serverfunded");
      console.log(`USDC funded by server.`);

      await claimEvmSwap(client, swapId);
      break;
    }

    case "clientfunded": {
      console.log(`\nWaiting for USDC to be funded on Arbitrum...`);
      await waitForSwapStatus(client, swapId, "serverfunded");
      console.log(`USDC funded by server.`);

      await claimEvmSwap(client, swapId);
      break;
    }

    case "clientfundingseen": {
      const confirmedSwap = await waitForAnySwapStatus(client, swapId, [
        "clientfunded",
        "serverfunded",
      ]);

      if (confirmedSwap.status === "clientfunded") {
        console.log(`\nBTC deposit confirmed.`);
        console.log(`\nWaiting for USDC to be funded on Arbitrum...`);
        await waitForSwapStatus(client, swapId, "serverfunded");
      }

      console.log(`USDC funded by server.`);
      await claimEvmSwap(client, swapId);
      break;
    }

    case "serverfunded": {
      await claimEvmSwap(client, swapId);
      break;
    }

    case "clientredeemed":
    case "serverredeemed": {
      console.log(`\nSwap already completed.`);
      break;
    }

    default: {
      console.log(
        `\nSwap is in state "${swap.status}" and cannot be continued.`,
      );
      break;
    }
  }

  const finalSwap = asBitcoinToEvm(
    await client.getSwap(swapId, { updateStorage: true }),
  );
  printSwapStatus(finalSwap);
}
