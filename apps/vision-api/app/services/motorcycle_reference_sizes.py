"""Exact classifier-family lookup for the local size experiment, never live state."""

from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

RULES_PATH = Path(__file__).resolve().parents[2] / "config/motorcycle_reference_sizes.json"


class ReferenceDimensions(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    width_m: float = Field(gt=0, le=5, allow_inf_nan=False)
    length_m: float = Field(gt=0, le=10, allow_inf_nan=False)
    basis: str = Field(min_length=1)


class ReferenceSizeRules(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    schema_version: Literal[1]
    min_score: float = Field(ge=0, le=1, allow_inf_nan=False)
    fallback: ReferenceDimensions
    classes: dict[str, ReferenceDimensions]


class ResolvedReferenceSize(ReferenceDimensions):
    status: Literal["EXPERIMENTAL_REFERENCE"] = "EXPERIMENTAL_REFERENCE"
    predicted_family: str | None
    score: float | None
    rule_class: str | None
    reason: Literal["CLASS_RULE", "NO_CLASSIFICATION", "CLASS_NOT_CONFIGURED", "BELOW_MIN_SCORE"]


def load_rules(path: Path | None = None) -> ReferenceSizeRules:
    # Read each analysis so editing the file takes effect without restarting.
    return ReferenceSizeRules.model_validate_json((path or RULES_PATH).read_bytes())


def reference_size(rules: ReferenceSizeRules, family: str | None, score: float | None) -> ResolvedReferenceSize:
    if family is None or score is None:
        reason = "NO_CLASSIFICATION"
    elif family not in rules.classes:
        reason = "CLASS_NOT_CONFIGURED"
    elif score < rules.min_score:
        reason = "BELOW_MIN_SCORE"
    else:
        reason = "CLASS_RULE"
    dimensions = rules.classes[family] if reason == "CLASS_RULE" else rules.fallback
    return ResolvedReferenceSize(**dimensions.model_dump(), predicted_family=family, score=score,
                                 rule_class=family if reason == "CLASS_RULE" else None, reason=reason)
