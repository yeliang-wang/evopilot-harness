import { digest } from "./utils.mjs";

export function reviewInputDigest(proposal) {
  const reviewInput = structuredClone(proposal);
  delete reviewInput.review;
  delete reviewInput.approval;
  delete reviewInput.publication;
  delete reviewInput.nextAction;
  return digest(reviewInput);
}
