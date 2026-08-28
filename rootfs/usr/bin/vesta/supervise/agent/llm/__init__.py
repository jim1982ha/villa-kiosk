"""The provider seam. ONE protocol, ONE implementation (ARCH-013).

⚠️ THIS IS DELIBERATELY NOT A MULTI-PROVIDER ABSTRACTION LAYER, AND THE
RESTRAINT IS THE DESIGN. `base.py` declares a protocol; `anthropic_sdk.py` is
the only file that implements it and the only file in the repository that
imports the SDK. A second adapter is a table entry when there is a second
provider to add — building the generalisation now would mean designing it
against one example, which is how an abstraction acquires the shape of its only
implementation and then fits nothing else.

What the seam buys today is not portability, which nobody needs yet. It is that
`policy.py`, `budget.py` and `audit.py` never import a provider, so swapping one
is a quality question and never an authority one.
"""

__all__ = ["base"]
