<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Diligence Live is frontend-only: all data flows through `src/lib/store.tsx` (React context + localStorage) and pure functions in `src/lib/mock-service.ts`; mock content lives in `src/lib/mock-data.ts`. Why: mock services can later be swapped for real API calls without UI changes.
- Simulation transcripts are deterministic, keyed by question id in `SCRIPT`; never randomize demo content. Why: the demo must be reproducible.
- Research is organised in rounds: `plan`/`interviews` on a project are the current round, earlier rounds live in `pastRounds`; read across rounds via `roundsOf`/`allInterviews`/`allHypotheses`. Why: findings and hypothesis numbering must consolidate across rounds.
- Findings consolidation derives neutral evidence from unscripted transcript answers as well as stored scripted findings. Why: custom and previously saved interviews must produce reviewable evidence without presenting qualified answers as confirmed conclusions.
- Which research round is being viewed is view state held in `src/lib/round-view.tsx` (React context), never URL search params. Why: child routes' `validateSearch` drops unknown params, and the header indicator must agree with the round-aware pages.
- The store starts with an empty project list and never auto-seeds; sample projects are added only on request via `loadSamples`, and the localStorage key is versioned so previously saved data can be discarded deliberately. Why: the consultant decides what is in their list, and old demo data must not reappear.
