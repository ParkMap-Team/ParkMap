# Footage policy

Governs real footage of the Sripatum parking area for #4, #5, #7, and the demo video (ADR 0005). Stand-in data from public datasets follows its own licence instead. Raw footage never goes into Git, issues, logs, or the browser.

## Approval

- Recording starts only after written approval (email or message kept by the team) from the project advisor. ParkMap is a class project, so the team does not seek separate approval from the university office that manages the lot.
- Any team member may record. The camera frames the parked motorcycles, not walkways or building entrances, and clips go to the source of truth below rather than staying on the phone.
- Accepted cost: if the university or a recorded person objects, the team has only the advisor's approval to show, and stops recording and deletes the affected footage on request.
- Photos and clips of the lot taken before this policy, such as the images used to train the current detector weights, move into the source of truth below and follow this policy from then on. They are covered by the same advisor approval once it is given.

## Raw and redacted footage

- Raw footage is used only inside the team: labelling, training, evaluation, and worker processing. It is never blurred, so detection and labels see the real scene.
- Anything shown outside the team has faces and licence plates blurred first: the demo video on the presenter's screen, slides, the report, and any still image. The blurred demo video keeps the raw video's timeline, so the video time shown in LIFF still matches.
- Accepted cost: one extra blurred copy of the demo video and of every image used in slides or the report.

## Storage and access

- The source of truth for raw footage is a private Google Drive folder owned by a Google account the team controls, preferably a university account. It is shared by name with the four team members only, with link sharing off. The advisor may view on request.
- Label Studio and the worker on Coolify and any machine or notebook used for training hold working copies, which follow the deletion rules below.
- Accepted cost: footage sits with a third party (Google), and deletion must cover every working copy.

## Training and publication

- Raw footage may be used for labelling, training, and evaluation inside the team. Private notebooks such as Colab or Kaggle count as working copies.
- Raw footage and datasets built from it are never uploaded to a public service or published, including public Roboflow projects, public Kaggle datasets, and public Hugging Face repositories. Weights trained on it are not shared outside the team.
- The project presents the product only: the blurred demo video, LIFF, and aggregate metrics. It does not publish a dataset.

## Retention and deletion

- Raw footage in the source of truth is kept after the project for retraining or a follow-up project, until the team members graduate. The Drive folder owner is responsible for deleting it then.
- Working copies on training machines or notebooks are deleted at the end of each session. Working copies on Coolify are deleted after the final presentation, leaving only the source of truth.
- On an objection, the affected clips are deleted from the source of truth and every working copy within 7 days.
- Blurred demo video, blurred report images, labels (coordinates without images), and metrics may be kept indefinitely.
- Accepted cost: raw footage of identifiable people outlives the project, and its deletion depends on one person remembering after the team disbands.
