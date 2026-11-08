#!/usr/bin/env bash
# Print every piece of reviewer feedback on a PR in one pass, with bot HTML noise removed.
# usage: fetch-pr-feedback.sh <pr-number> [owner/repo] [since-iso8601]
#   since: only show inline/issue comments created after this time (for "new comments came in")
set -euo pipefail

PR="${1:?usage: fetch-pr-feedback.sh <pr-number> [owner/repo] [since-iso8601]}"
REPO="${2:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
SINCE="${3:-1970-01-01T00:00:00Z}"
OWNER="${REPO%/*}"
NAME="${REPO#*/}"

# Drop <details> blocks (CodeRabbit "Prompt for AI agents", analysis chains), comments and tags.
CLEAN='gsub("(?s)<details>.*?</details>";"") | gsub("(?s)<!--.*?-->";"") | gsub("<[^>]+>";"") | gsub("\n\\s*\n+";"\n")'

echo "## PR $REPO#$PR"
gh pr view "$PR" -R "$REPO" --json state,mergeable,mergeStateStatus,reviewDecision,headRefOid \
  --jq '"state=\(.state) mergeable=\(.mergeable) mergeState=\(.mergeStateStatus) decision=\(.reviewDecision) head=\(.headRefOid[0:9])"'

echo
echo "## Checks not passing"
gh pr checks "$PR" -R "$REPO" 2>&1 | grep -viE $'\tpass\t|\tskipping\t' || echo "(all passing or skipped)"

echo
echo "## Unresolved review threads (id, file:line, last author)"
gh api graphql -f query='
query($o:String!,$n:String!,$pr:Int!){repository(owner:$o,name:$n){pullRequest(number:$pr){
  reviewThreads(first:100){nodes{id isResolved isOutdated path line
    comments(last:1){nodes{databaseId author{login} body}}}}}}}' \
  -f o="$OWNER" -f n="$NAME" -F pr="$PR" \
  --jq ".data.repository.pullRequest.reviewThreads.nodes[]
    | select(.isResolved==false)
    | \"[\(.id)] \(.path):\(.line // \"outdated\") outdated=\(.isOutdated) last=\(.comments.nodes[0].author.login) comment=\(.comments.nodes[0].databaseId)\"" \
  || echo "(graphql failed)"

echo
echo "## Inline comments since $SINCE (top-level only; reply with gh api .../pulls/$PR/comments -F in_reply_to=<id>)"
gh api --paginate "repos/$REPO/pulls/$PR/comments" \
  --jq ".[] | select(.in_reply_to_id==null and .created_at > \"$SINCE\")
    | \"### #\(.id) [\(.user.login)] \(.path):\(.line // .original_line) commit=\(.commit_id[0:9])\n\" + (.body | $CLEAN | .[0:1800])"

echo
echo "## Reviews with a body"
gh api --paginate "repos/$REPO/pulls/$PR/reviews" \
  --jq ".[] | select((.body|length)>0 and .submitted_at > \"$SINCE\")
    | \"### [\(.user.login)] \(.state) \(.submitted_at)\n\" + (.body | $CLEAN | .[0:1500])"

echo
echo "## Issue (conversation) comments since $SINCE, excluding CI noise"
gh api --paginate "repos/$REPO/issues/$PR/comments" \
  --jq ".[] | select(.created_at > \"$SINCE\" and .user.login != \"github-actions[bot]\")
    | \"### [\(.user.login)] \(.created_at)\n\" + (.body | $CLEAN | .[0:1200])"
