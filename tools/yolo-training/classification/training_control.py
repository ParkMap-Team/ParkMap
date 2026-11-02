"""Validation-only stopping policy; zero patience preserves fixed-epoch runs."""

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
