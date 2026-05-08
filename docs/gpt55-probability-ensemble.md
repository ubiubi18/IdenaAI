# GPT-5.5 Probability Ensemble

`probability_ensemble` is an experimental short-session flip solver mode for external vision-capable providers. It is off by default.

The mode asks the model to score option A and option B independently instead of asking it to choose left or right. Each run must treat the current flip as independent: previous flips in the session are not evidence and must not be used as a pattern. The prompt also repeats that A/B, left/right, first/second, and candidate order are arbitrary placeholders.

The general experimental default is three probability runs, but the short-session OpenAI parallel autosolve lane currently forces two runs so the audit pass has a realistic chance to finish before the submit guard. Each prompt asks for internal visual observation, independent scoring, and adversarial recheck passes before returning JSON. Candidate order is swapped across runs when `probabilityUseSwappedOrder` is enabled, and application code maps the returned A/B scores back to original left/right before aggregation. The app computes side scores from chronology, cause-effect, entity continuity, and final state probabilities, then chooses the higher average when the delta is large enough or force-decision mode is enabled.

This reduces side and position bias, but it does not eliminate it. It can also cost more latency and tokens than the legacy binary decision prompt. Measure benchmark accuracy before using it on a valuable real identity.
