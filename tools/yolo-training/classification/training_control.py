"""Validation-only stopping policy and the per-epoch learning-rate schedule; defaults keep fixed-rate, fixed-epoch runs."""

import math


class EarlyStopping:
    def __init__(self, patience=0):
        if type(patience) is not int or patience < 0:
            raise ValueError("patience must be a nonnegative integer")
        self.patience, self.best, self.bad_epochs = patience, -math.inf, 0

    def update(self, macro_f1):
        if not math.isfinite(macro_f1):
            raise ValueError("Early stopping requires finite validation Macro F1")
        if macro_f1 > self.best:
            self.best, self.bad_epochs = macro_f1, 0
        else:
            self.bad_epochs += 1
        return bool(self.patience and self.bad_epochs >= self.patience)


def lr_factor(epoch, epochs, scheduler="constant", warmup_epochs=0):
    """Multiplier of the configured learning rate for 1-based epoch.

    constant: always 1. cosine: linear warm-up over warmup_epochs, then cosine decay towards 0 by the last epoch.
    """
    if scheduler == "constant":
        return 1.0
    if scheduler != "cosine":
        raise ValueError('scheduler must be "constant" or "cosine"')
    if epoch <= warmup_epochs:
        return epoch / (warmup_epochs + 1)
    progress = (epoch - warmup_epochs - 1) / max(1, epochs - warmup_epochs)
    return 0.5 * (1 + math.cos(math.pi * progress))
