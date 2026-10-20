KataGo neural network evaluation modules vendored from:
https://github.com/Sir-Teo/web-katrain
Source revision: 8dd813aeb565cbdad5215dc75204fc40fd519c50
Licensed under the MIT license; see LICENSE.

Modifications to the integration are confined to MieGO's adapter.
Two compatibility shims (src/utils/gameLogic.ts and src/engine/katago/superkoHistory.ts)
implement only the Chinese-rules subset required by MieGO. Features derived
from a five-move history; complete search and full superko handling are not provided.

The small model is downloaded during the build from that project's pinned
GitHub revision and verified against the Git blob SHA-1
7c87d9e1f4499b892974e78cac53dbf2ca84b84e.
The model is the authors' approximately 3.8 MB test network and is unsuitable
for strong Go analysis.
MieGO serves it with its large weight blocks rounded to float16
(src/katago/half-model.ts), which halves the download.
