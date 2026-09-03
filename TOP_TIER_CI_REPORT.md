# Top-tier rebuild verification

- Typecheck: failure
- Tests: failure
- Build: failure

## Typecheck
```text

> novel-reader@2.0.0 typecheck
> tsc --noEmit

next.config.ts(19,14): error TS1005: ',' expected.
next.config.ts(19,22): error TS1005: ',' expected.
src/app/api/media/[id]/favorite/route.ts(11,9): error TS1005: ':' expected.
src/app/api/media/[id]/favorite/route.ts(11,52): error TS1005: ',' expected.
src/app/api/media/[id]/favorite/route.ts(12,6): error TS1005: ':' expected.
src/app/api/media/[id]/favorite/route.ts(12,14): error TS1005: ';' expected.
src/app/api/media/[id]/favorite/route.ts(12,35): error TS1128: Declaration or statement expected.
src/app/api/media/[id]/favorite/route.ts(12,36): error TS1128: Declaration or statement expected.
src/app/api/media/[id]/favorite/route.ts(12,73): error TS1128: Declaration or statement expected.
src/app/api/media/[id]/grove/route.ts(11,9): error TS1005: ':' expected.
src/app/api/media/[id]/grove/route.ts(11,52): error TS1005: ',' expected.
src/app/api/media/[id]/grove/route.ts(12,6): error TS1005: ':' expected.
src/app/api/media/[id]/grove/route.ts(12,14): error TS1005: ';' expected.
src/app/api/media/[id]/grove/route.ts(12,35): error TS1128: Declaration or statement expected.
src/app/api/media/[id]/grove/route.ts(12,36): error TS1128: Declaration or statement expected.
src/app/api/media/[id]/grove/route.ts(12,73): error TS1128: Declaration or statement expected.
src/app/api/media/[id]/recommendation/route.ts(12,9): error TS1005: ':' expected.
src/app/api/media/[id]/recommendation/route.ts(12,52): error TS1005: ',' expected.
src/app/api/media/[id]/recommendation/route.ts(13,6): error TS1005: ':' expected.
src/app/api/media/[id]/recommendation/route.ts(13,14): error TS1005: ';' expected.
src/app/api/media/[id]/recommendation/route.ts(13,35): error TS1128: Declaration or statement expected.
src/app/api/media/[id]/recommendation/route.ts(13,36): error TS1128: Declaration or statement expected.
src/app/api/media/[id]/recommendation/route.ts(13,73): error TS1128: Declaration or statement expected.
src/app/api/media/[id]/unlock/route.ts(11,9): error TS1005: ':' expected.
src/app/api/media/[id]/unlock/route.ts(11,52): error TS1005: ',' expected.
src/app/api/media/[id]/unlock/route.ts(12,6): error TS1005: ':' expected.
src/app/api/media/[id]/unlock/route.ts(12,14): error TS1005: ';' expected.
src/app/api/media/[id]/unlock/route.ts(12,35): error TS1128: Declaration or statement expected.
src/app/api/media/[id]/unlock/route.ts(12,36): error TS1128: Declaration or statement expected.
src/app/api/media/[id]/unlock/route.ts(12,73): error TS1128: Declaration or statement expected.
src/app/api/novels/[id]/favorite/route.ts(10,9): error TS1005: ':' expected.
src/app/api/novels/[id]/favorite/route.ts(10,52): error TS1005: ',' expected.
src/app/api/novels/[id]/favorite/route.ts(11,6): error TS1005: ':' expected.
src/app/api/novels/[id]/favorite/route.ts(11,14): error TS1005: ';' expected.
src/app/api/novels/[id]/favorite/route.ts(11,35): error TS1128: Declaration or statement expected.
src/app/api/novels/[id]/favorite/route.ts(11,36): error TS1128: Declaration or statement expected.
src/app/api/novels/[id]/favorite/route.ts(11,73): error TS1128: Declaration or statement expected.
src/app/api/novels/[id]/grove/route.ts(10,9): error TS1005: ':' expected.
src/app/api/novels/[id]/grove/route.ts(10,52): error TS1005: ',' expected.
src/app/api/novels/[id]/grove/route.ts(11,6): error TS1005: ':' expected.
src/app/api/novels/[id]/grove/route.ts(11,14): error TS1005: ';' expected.
src/app/api/novels/[id]/grove/route.ts(11,35): error TS1128: Declaration or statement expected.
src/app/api/novels/[id]/grove/route.ts(11,36): error TS1128: Declaration or statement expected.
src/app/api/novels/[id]/grove/route.ts(11,73): error TS1128: Declaration or statement expected.
src/app/api/novels/[id]/recommendation/route.ts(11,9): error TS1005: ':' expected.
src/app/api/novels/[id]/recommendation/route.ts(11,52): error TS1005: ',' expected.
src/app/api/novels/[id]/recommendation/route.ts(12,6): error TS1005: ':' expected.
src/app/api/novels/[id]/recommendation/route.ts(12,14): error TS1005: ';' expected.
src/app/api/novels/[id]/recommendation/route.ts(12,35): error TS1128: Declaration or statement expected.
src/app/api/novels/[id]/recommendation/route.ts(12,36): error TS1128: Declaration or statement expected.
src/app/api/novels/[id]/recommendation/route.ts(12,73): error TS1128: Declaration or statement expected.
src/app/api/novels/[id]/unlock/route.ts(12,9): error TS1005: ':' expected.
src/app/api/novels/[id]/unlock/route.ts(12,52): error TS1005: ',' expected.
src/app/api/novels/[id]/unlock/route.ts(13,6): error TS1005: ':' expected.
src/app/api/novels/[id]/unlock/route.ts(13,14): error TS1005: ';' expected.
src/app/api/novels/[id]/unlock/route.ts(13,35): error TS1128: Declaration or statement expected.
src/app/api/novels/[id]/unlock/route.ts(13,36): error TS1128: Declaration or statement expected.
src/app/api/novels/[id]/unlock/route.ts(13,73): error TS1128: Declaration or statement expected.
src/app/api/original/[id]/engagement/route.ts(15,9): error TS1005: ':' expected.
src/app/api/original/[id]/engagement/route.ts(15,52): error TS1005: ',' expected.
src/app/api/original/[id]/engagement/route.ts(16,6): error TS1005: ':' expected.
src/app/api/original/[id]/engagement/route.ts(16,14): error TS1005: ';' expected.
src/app/api/original/[id]/engagement/route.ts(16,35): error TS1128: Declaration or statement expected.
src/app/api/original/[id]/engagement/route.ts(16,36): error TS1128: Declaration or statement expected.
src/app/api/original/[id]/engagement/route.ts(16,73): error TS1128: Declaration or statement expected.
src/app/api/original/[id]/engagement/route.ts(17,1): error TS1128: Declaration or statement expected.
src/app/api/original/[id]/favorite/route.ts(12,9): error TS1005: ':' expected.
src/app/api/original/[id]/favorite/route.ts(12,52): error TS1005: ',' expected.
src/app/api/original/[id]/favorite/route.ts(13,6): error TS1005: ':' expected.
src/app/api/original/[id]/favorite/route.ts(13,14): error TS1005: ';' expected.
src/app/api/original/[id]/favorite/route.ts(13,35): error TS1128: Declaration or statement expected.
src/app/api/original/[id]/favorite/route.ts(13,36): error TS1128: Declaration or statement expected.
src/app/api/original/[id]/favorite/route.ts(13,73): error TS1128: Declaration or statement expected.
src/app/api/original/[id]/grove/route.ts(12,9): error TS1005: ':' expected.
src/app/api/original/[id]/grove/route.ts(12,52): error TS1005: ',' expected.
src/app/api/original/[id]/grove/route.ts(13,6): error TS1005: ':' expected.
src/app/api/original/[id]/grove/route.ts(13,14): error TS1005: ';' expected.
src/app/api/original/[id]/grove/route.ts(13,35): error TS1128: Declaration or statement expected.
src/app/api/original/[id]/grove/route.ts(13,36): error TS1128: Declaration or statement expected.
src/app/api/original/[id]/grove/route.ts(13,73): error TS1128: Declaration or statement expected.
src/app/api/original/[id]/tip/route.ts(10,9): error TS1005: ':' expected.
src/app/api/original/[id]/tip/route.ts(10,52): error TS1005: ',' expected.
src/app/api/original/[id]/tip/route.ts(11,6): error TS1005: ':' expected.
src/app/api/original/[id]/tip/route.ts(11,14): error TS1005: ';' expected.
src/app/api/original/[id]/tip/route.ts(11,35): error TS1128: Declaration or statement expected.
src/app/api/original/[id]/tip/route.ts(11,36): error TS1128: Declaration or statement expected.
src/app/api/original/[id]/tip/route.ts(11,73): error TS1128: Declaration or statement expected.
src/app/api/original/authors/[id]/block/route.ts(10,9): error TS1005: ':' expected.
src/app/api/original/authors/[id]/block/route.ts(10,52): error TS1005: ',' expected.
src/app/api/original/authors/[id]/block/route.ts(11,6): error TS1005: ':' expected.
src/app/api/original/authors/[id]/block/route.ts(11,14): error TS1005: ';' expected.
src/app/api/original/authors/[id]/block/route.ts(11,35): error TS1128: Declaration or statement expected.
src/app/api/original/authors/[id]/block/route.ts(11,36): error TS1128: Declaration or statement expected.
src/app/api/original/authors/[id]/block/route.ts(11,73): error TS1128: Declaration or statement expected.
```

## Tests
```text
  
      at TestContext.<anonymous> (/home/runner/work/novel-reader/novel-reader/src/lib/content-access.test.ts:150:10)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1397:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:969:18)
      at Test.postRun (node:internal/test_runner/test:1537:19)
      at Test.run (node:internal/test_runner/test:1462:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:969:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: true,
    expected: false,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at src/lib/db.test.ts:2:1089
✖ migrates supported application data and discards retired access records (545.700523ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  
  3 !== 0
  
      at TestContext.<anonymous> (/home/runner/work/novel-reader/novel-reader/src/lib/db.test.ts:228:12)
      at async Test.run (node:internal/test_runner/test:1404:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 3,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at src/lib/original.test.ts:5:1942
✖ original articles derive access from price and transfer paid unlocks exactly once (253.584037ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
  
    {
  +   counted: false,
  +   duplicateEvent: false,
      readingHistoryRecorded: false,
  +   recorded: false
  -   recorded: true
    }
  
      at TestContext.<anonymous> (/home/runner/work/novel-reader/novel-reader/src/lib/original.test.ts:166:10)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1397:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:969:18)
      at Test.postRun (node:internal/test_runner/test:1537:19)
      at Test.run (node:internal/test_runner/test:1462:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:969:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: { recorded: false, counted: false, readingHistoryRecorded: false, duplicateEvent: false },
    expected: { recorded: true, readingHistoryRecorded: false },
    operator: 'deepStrictEqual',
    diff: 'simple'
  }

test at src/lib/password.test.ts:2:940
✖ creates salted password hashes and verifies the original password (5.354828ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected
  
  + Promise {
  +   <rejected> TypeError: storedHash.startsWith is not a function
  +       at verifyPassword (/home/runner/work/novel-reader/novel-reader/src/lib/password.ts:98:18)
  +       at TestContext.<anonymous> (/home/runner/work/novel-reader/novel-reader/src/lib/password.test.ts:9:16)
  +       at Test.runInAsyncScope (node:async_hooks:227:14)
  +       at Test.run (node:internal/test_runner/test:1397:25)
  +       at Test.start (node:internal/test_runner/test:1257:17)
  +       at startSubtestAfterBootstrap (node:internal/test_runner/harness:387:17),
  +   Symbol(async_id_symbol): 86,
  +   Symbol(trigger_async_id_symbol): 37
  + }
  - true
  
      at TestContext.<anonymous> (/home/runner/work/novel-reader/novel-reader/src/lib/password.test.ts:9:10)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1397:25)
      at Test.start (node:internal/test_runner/test:1257:17)
      at startSubtestAfterBootstrap (node:internal/test_runner/harness:387:17) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: [Promise],
    expected: true,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at src/lib/password.test.ts:2:1445
✖ rejects malformed or unreasonably cheap password hashes (0.557155ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected
  
  + Promise {
  +   <pending>,
  +   Symbol(async_id_symbol): 99,
  +   Symbol(trigger_async_id_symbol): 41
  + }
  - false
  
      at TestContext.<anonymous> (/home/runner/work/novel-reader/novel-reader/src/lib/password.test.ts:14:10)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1397:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:969:18)
      at Test.postRun (node:internal/test_runner/test:1537:19)
      at Test.run (node:internal/test_runner/test:1462:12)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: [Promise],
    expected: false,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at src/lib/search.test.ts:2:1106
✖ uses the full-text index for mixed encodings and safely includes changed books (430.742987ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
  
    [
  -   'GB18030 小说',
      'UTF8 小说'
    ]
  
      at TestContext.<anonymous> (/home/runner/work/novel-reader/novel-reader/src/lib/search.test.ts:60:12)
      at async Test.run (node:internal/test_runner/test:1404:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: [ 'UTF8 小说' ],
    expected: [ 'GB18030 小说', 'UTF8 小说' ],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }

test at src/lib/search.test.ts:10:1702
✖ merges ready library shards and isolates a removed shard (242.862598ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
  
    [
      '第一本',
  -   '第二本'
    ]
  
      at TestContext.<anonymous> (/home/runner/work/novel-reader/novel-reader/src/lib/search.test.ts:192:12)
      at async Test.run (node:internal/test_runner/test:1404:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:969:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: [ '第一本' ],
    expected: [ '第一本', '第二本' ],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }
```

## Build
```text

> novel-reader@2.0.0 build
> next build

 ⨯ Failed to load next.config.ts, see more info here https://nextjs.org/docs/messages/next-config-error

> Build error occurred
[Error:   [31mx[0m Expected ',', got '{'
    ,-[19:1]
 [2m16[0m |           {
 [2m17[0m |             key: "Content-Security-Policy-Report-Only",
 [2m18[0m |             value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'",
 [2m19[0m |           },${process.env.ENABLE_HSTS === "1" ? `
    : [35;1m             ^[0m
 [2m20[0m |           { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },` : ""}
 [2m21[0m |         ],
 [2m22[0m |       },
    `----


Caused by:
    Syntax Error] {
  code: 'GenericFailure'
}
```
