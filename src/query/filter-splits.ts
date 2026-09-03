import type { FireflySearchResult, FireflyTransactionSplit } from "../types.js";

// Firefly can return an entire group when only one journal matches a search.
export function filterSplits(groups: FireflySearchResult[], matches: (split: FireflyTransactionSplit) => boolean): FireflySearchResult[] {
  return groups.map(group => ({ ...group, attributes: {
    ...group.attributes, transactions: group.attributes.transactions.filter(matches),
  } })).filter(group => group.attributes.transactions.length > 0);
}
