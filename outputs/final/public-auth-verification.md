# LifeOps Public/Auth Local Verification

- Date: 2026-08-15
- Authority: ADR-024
- Scope: P2 public orbit, public details and authentication boundary
- Boundary: local source/browser/API verification only; this is not an immutable-image, UHub or Kubernetes deployment claim

## Ordered P2-T6 gate

| Command | Exit | Fresh result |
|---|---:|---|
| `npm.cmd test` | 0 | 40 files, 165 tests passed |
| `npm.cmd run test:server` | 0 | 32 files passed, 1 exact-MySQL integration file skipped; 204 tests passed, 43 exact-MySQL-only tests skipped |
| `npm.cmd run typecheck` | 0 | TypeScript project references passed |
| `npm.cmd run typecheck:server` | 0 | server no-emit typecheck passed |
| `npm.cmd run build` | 0 | production Web build passed; Vite transformed 520 modules |
| `npm.cmd run build:server` | 0 | production server TypeScript build passed |
| `npm.cmd run test:e2e -- tests/public-final.spec.ts tests/responsive-accessibility.spec.ts` | 0 | Chromium 7/7 passed |
| `npm.cmd run test:e2e:remote` | 0 | production-auth Chromium 3/3 passed, including rejected credentials, transport recovery, browser Back and real API login/persistence |

The skipped server tests belong to the separately scoped official-MySQL integration file. P2-T6 does not restart MySQL or substitute those skips for a required public/auth test; all commands named by the P2-T6 gate completed successfully.

## Reproducibility metadata

- OS: Windows NT `10.0.22631`, x64.
- Node.js: `v24.15.0`.
- Browser: Chromium `151.0.7922.34`.
- Font stack: `Noto Sans SC Variable`, `Microsoft YaHei UI`, sans-serif.
- Dependency lock: `package-lock.json` SHA-256 `3A1451ED65A71A20A8A215B827EA168DD71834F67AA8A351BE0BF604ECF1D38C`.
- Standard DPR: 1. Zoom/reflow equivalence: 320×720 CSS px at DPR 2.
- Viewports: 1440×900, 1024×768, 768×1024 and 390×844.
- Color schemes: explicit day and night capture passes.
- Motion modes: normal and `prefers-reduced-motion: reduce`.
- Capture stabilization: screenshots disable active animation; filmstrip frames use isolated pages and an explicit product pause state.

## Geometry, ownership and performance

- The planned browser gate sampled 20 animation frames × 5 objects and passed the 4px rendered-path limit with one scoped public GSAP owner and no transform mutations outside that owner.
- A fresh diagnostic using the identical 1024-point nearest-path method measured a maximum rendered path error of `0.6169359139431677px` across 100 object/frame samples.
- The current evidence manifest contains 71 performance frames with P95 `16.700000000000045ms` and maximum `16.800000000000068ms`.
- All eight home viewport/theme diagnostics report zero horizontal overflow and five visible labels.
- CSS layer sizes are tokens 1,472 bytes, base 24,590 bytes, public 32,837 bytes and motion 8,201 bytes; `index.css` contains only ordered imports.

## Interaction and semantic results

- Keyboard entry, fixed return, Browser Back and Escape return focus to the originating public object.
- Return state restores all five live playheads, home scroll, theme and source focus.
- Wheel input does not change routes. The visible pause control, focused-object pause, document-hidden suspension and offscreen suspension preserve the public scene and resume correctly.
- The 390px login remains a full-screen task layer over a stable astrolabe; all approved controls meet the 44px target contract and the 320 CSS px run has no horizontal overflow.
- Reduced motion retains the same objects, labels, routes, login task and authenticated destination without spatial interpolation. Its five captured frames are byte-identical; normal-motion frame hashes are all distinct.
- The login content is visible and unobscured in both day and night states. Normal entry contains no white intermediate frame.

## Evidence set

- Browser/performance manifest: `outputs/evidence/browser/p2-t5/public-browser-performance-manifest.json`.
- Trace: `outputs/evidence/browser/p2-t5/public-home-detail-return-trace.zip`.
- Home screenshots: `outputs/evidence/browser/p2-t5/public-home-{day|night}-{1440|1024|768|390}.png` plus `public-home-day-320-dpr2.png`.
- Login screenshots: `outputs/evidence/browser/p2-t5/public-login-{day|night}-{1440|1024|768|390}.png` plus `public-login-day-320-dpr2.png`.
- Detail screenshots: `outputs/evidence/browser/p2-t5/public-detail-{now|doing|learning|moments|archive}-{1440|1024|768|390}.png`.
- Normal filmstrip: `outputs/evidence/browser/p2-t5/filmstrip-public-normal-{000|170|340|510|680}ms.png`.
- Reduced filmstrip: `outputs/evidence/browser/p2-t5/filmstrip-public-reduced-{000|170|340|510|680}ms.png`.

The artifact manifest records SHA-256 and byte length for all 48 PNGs and the trace ZIP. All static captures were opened and reviewed. The trace archive contains the Playwright trace, network, stack and resource entries. Direct PNG hashes and pixel inspection were used to resolve an image-viewer compositing anomaly: the byte-identical reduced files contain stable, nonblank public-scene anchors.

The first fresh remote-auth rerun exposed a test-observation race: the URL assertion could settle immediately before React Router invoked `document.startViewTransition`. The assertion now polls the same required transition counter with a finite timeout, and the complete remote-auth gate then passed 3/3; the product transition requirement was not weakened.

## Manual five-axis conclusion

- Identity: accepted. The sundial, navigation flag, open book, viewfinder and tree/archive ring remain attached to four visible authored ellipse tracks around the quiet daylight aperture.
- Page-native structure: accepted. Home, login and all five details retain distinct structures; no equal-layout card template was introduced.
- State truth: accepted. Published/empty/error/login/network states remain honest and recoverable.
- Accessibility: accepted locally. Labels remain visible, touch targets and reflow pass, and keyboard/focus/reduced-motion contracts pass.
- Performance/motion: accepted locally. There is no competing transform owner, unexplained trace work, detached object, hidden label, white flash or unresolved frame instability.

No cookie, credential, token, raw request header, kubeconfig or private source body is included in this report or its named evidence.
