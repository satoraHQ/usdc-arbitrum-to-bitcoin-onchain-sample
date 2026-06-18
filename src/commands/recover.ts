import { buildClient } from "../client.js";

export async function recoverSwaps() {
  const client = await buildClient();

  console.log(`\nRecovering swaps from server...`);
  const recovered = await client.recoverSwaps();
  console.log(`Found ${recovered.swaps.length} swap(s).`);

  for (const swap of recovered.swaps) {
    const response = swap.response;
    console.log(
      `  ${swap.swapId} - ${response.status} (${response.direction})`,
    );
  }
}
