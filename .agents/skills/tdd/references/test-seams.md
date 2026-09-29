# ParkMap test seams

Choose the highest seam that remains fast and deterministic.

| Behavior                                          | Preferred seam                             | Escalate when                                                 |
| ------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------- |
| Parking geometry or uncertainty rule              | Pure Python function                       | Calibration persistence affects the result                    |
| Inference orchestration                           | Service with controlled model adapter      | Transport validation is part of the requirement               |
| Image validation and HTTP contract                | Focused FastAPI test                       | LIFF browser behavior must be proven                           |
| Camera state persistence                          | Store integration                          | User-visible behavior spans additional processes              |
| Map data transformation                           | Pure TypeScript function                   | Hydration and interaction matter                              |
| LIFF interaction                                  | Small client component                     | Journey depends on LINE browser APIs                          |
| Critical cross-app journey                        | Browser E2E                                | Never escalate further; diagnose the seam                     |

Do not query the database as a side channel to verify a use case when its public result or repository interface can prove the behavior. Persistence integration tests may inspect persistence because persistence is their public subject.
