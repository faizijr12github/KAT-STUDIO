# Editing and learning

## Project workflow

1. Create a project and set its delivery format and client brand. Choose a pinned style version in Editing Styles or Project Setup. Browse all 31 bundled presets by category and compare two before choosing. Creator Pack cards are visual layout examples. A matching local GLK render becomes playable when that workspace contains one.
2. Import the project folder. Auto detects footage, cutaways, caption references, logos, music and closing cards from file types and relative paths. Use an explicit category for exceptions. A source preview follows the project format and serves as intake.
3. Save explicit project directions and separately scoped client preferences in Instructions and history. Add revision notes at the specific draft frame. Approved edits and corrections remain attached to the originating project.
4. Use Prepare edit for Codex or `node kat.mjs context PROJECT_ID` to retrieve the brief, project assets, style version, prior drafts, timestamped notes, verified decisions and relevant preferences. Apply the latest explicit project directions first. Use media from the local Studio workspace.
5. Build the edit in an appropriate local workflow, review it and register it as a new draft. Compare versions, leave feedback, approve the selected draft and confirm export.

## Register an assisted edit

Run `node kat.mjs register PROJECT_ID submission.json` with an absolute MP4 path in the submission. For example:

```json
{
  "contextToken": "<from kat.mjs context>",
  "file": "/absolute/path/to/reel.mp4",
  "summary": "Describe the edit and what was verified.",
  "recipe": {
    "style": {"id": "<selected style ID>", "version": 1},
    "sources": ["<asset SHA-256>"],
    "review": {
      "branding": "Record the visual check.",
      "pacing": "Record the cut review.",
      "audioSync": "Record the timing check.",
      "transitions": "Record the transition review."
    }
  }
}
```

For a required closing card, include `recipe.endCard` with its `hash`, output `startFrame`, `sourceInFrame` and `frames`. Optionally provide `recipe.appliedNotes` with pending note IDs. Registration checks the current context, aspect ratio, selected style version, asset references, required evidence, FFmpeg decoding, peak level and end-screen similarity. Human or assisted review supplies the evidence for visual and editorial criteria. The Introduction worker supports its existing bounded controls. Other edits use the assisted workflow.

## Reusable editing lessons

- Read the project brief and reference footage before changing the timeline. Preserve the original scope and accurate names and spellings. Use project-specific feedback over generic workflow defaults.
- Establish the delivery canvas first. Inspect the actual render at phone size and check the crop, captions, title and lower-third separation. Keep each phrase legible, with stable positioning and limited emphasis.
- When requested, use background-free Poppins captions and reveal each word at its vocal onset. Keep each word's position fixed as the phrase builds. Use a subtle shadow where needed. Use steady full phrases when the project calls for them.
- Use continuous presenter footage where possible. Follow narration with realistic cutaways, retain original client footage where it establishes people or context, and credit stock when used. Inspect all transition frames for flashes, stray frames and unintended holds.
- Keep dialogue forward and check audio sync at multiple points after rendering. Use the supplied end screen and verify its matching frames. Keep earlier drafts available for review.

The database records project instructions, feedback, approved corrections, styles, editorial recipes and review evidence. Client preferences carry into other projects for that client. Project-specific instructions remain scoped to their project. Bundled styles seed only missing versions. Use verified backups for private workspace migration, including the original feedback, prompts, and media.
