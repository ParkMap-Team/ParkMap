# Fingerprint the published analysis configuration

Include the parking-analysis revision and a compact fingerprint of the model weights and inference settings, including confidence and NMS IoU, in each published `analysis_version`. Keep the value within the existing 64-character contract. A fixed `parking-analysis-v2` value was rejected because states produced by different weights or thresholds would be indistinguishable in stored results. The accepted cost is computing and recording a new fingerprint whenever weights or inference settings change.
