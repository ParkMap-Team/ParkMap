# classification/_eval_transfer

A split archive, `pack.tar.part_aa` + `pack.tar.part_ab` (about 560 MB together, created 2026-11-02). No script or
document in the repository creates or reads it; it looks like a manual package for moving evaluation data between machines.

To rebuild the archive: `copy /b pack.tar.part_aa + pack.tar.part_ab pack.tar` (Windows) or `cat pack.tar.part_* > pack.tar`.

The archive parts are Git-ignored (only this README is tracked). Delete the folder when it is no longer needed.
