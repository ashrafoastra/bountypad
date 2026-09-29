/** The challenge in plain words (used in platform posts). */
export function actionPhrase(action: string, ticker: string, phrase?: string | null) {
  switch (action) {
    case "TWEET_CASHTAG": return `post $${ticker} on X`;
    case "TWEET_CONTRACT": return "post the contract address on X";
    case "QUOTE_LAUNCH": return "quote this post";
    case "VIDEO_PHRASE": return `say "${phrase ?? ""}" in a video on X`;
    case "BIO_CONTRACT": return "put the contract address in their X bio";
    default: return action;
  }
}
