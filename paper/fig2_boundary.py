#!/usr/bin/env python3
"""Fig. 2: the survival boundary under full isolation on LiveKit, as three constants meeting.

Unlike fig1_reversal.py, nothing plotted here is transcribed: every time is read at run time from
logs/study/removal-race/livekit.json, the per-trial rows written by client/runner/removal-race.mjs
from the trial records and the LiveKit server logs. Times are seconds after isolation onset.

Which trials. One trial per panel, chosen by rule and not by eye: among the retained LiveKit
full-isolation trials of the condition (18 s for panel a, 19 s for panel b) whose server log
settles the order of events, the one with the median server-side ICE-failure time (the lower
median when the count is even).

Observed and not observed. The following are read from records and drawn solid: the isolation,
the client's restart attempts (begin, end, result), the server's ICE failure, the removal of the
participant, and each resume request the server received with its answer. The SYN retransmissions
of the client's connection are NOT in any record (there is no packet capture). They are drawn
hollow, at the times the kernel's documented schedule gives: 0, 1, 2, 3, 4, 5, 7, 11, 19 times
the initial timeout after the connection is opened (Linux v6.18, tcp_syn_linear_timeouts = 4;
see logs/study/removal-race/SERVER-TIMERS.md). The unit is estimated once, from all settled
survivors, as (server receipt - client open) / 11. The one point that is both scheduled and
observed, the request that got through in panel (a), is drawn solid at its observed time.

The script stops before drawing if the records do not have the shape the figure claims: see check().

Reproducibility of the PDF: built with matplotlib 3.9.4 on Python 3.9.1, written without a creation
timestamp. Re-running on that matplotlib version reproduces the committed file byte for byte; a
different version produces a different, equally correct PDF. The Python dependency is not pinned
in this repository.

usage: python3 paper/fig2_boundary.py     (run from anywhere inside the repository; writes fig2_boundary.pdf and .png beside itself)"""
import json, os, sys
import matplotlib
matplotlib.use("Agg")
matplotlib.rcParams["pdf.fonttype"] = 42  # embed TrueType, not Type 3 (IEEE PDF eXpress rejects Type 3)
matplotlib.rcParams["ps.fonttype"] = 42
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.patches import Patch

BLUE, ORANGE, INK, MUTED, GREY, LIGHT = "#2a78d6", "#eb6834", "#1a1a19", "#5f5e58", "#8f8e86", "#d9d8d2"
SCHEDULE = [0, 1, 2, 3, 4, 5, 7, 11, 19]  # SYN transmissions, in units of the initial timeout
HERE = os.path.dirname(os.path.abspath(__file__))
rows = [r for r in json.load(open(os.path.join(HERE, "..", "logs", "study", "removal-race", "livekit.json")))
        if r["cohort"] == "retained" and r["mode"] == "all" and r["verdict"] == "as predicted"]

survivors = [r for r in rows if r["regime"] != "R2"]
accepted = lambda r: next(q for q in r["log"]["resumes"] if q["answer"] == "accepted")
UNIT = sum((accepted(r)["t"] - r["log"]["client"]["attempts"][0]["t"]) / 11 for r in survivors) / len(survivors)


def pick(D, rebuilt):
    g = sorted((r for r in rows if r["D"] == D and (r["regime"] == "R2") == rebuilt), key=lambda r: r["log"]["iceFailed"][-1 if not rebuilt else 0])
    return g[(len(g) - 1) // 2], len(g)


def facts(r, rebuilt):
    c, lg = r["log"]["client"], r["log"]
    d = dict(id=f'{r["set"]}/{r["dir"]}', D=r["D"], restore=r["restore"], open=c["attempts"][0]["t"], a1=(c["actions"][0]["t"], c["actions"][0]["end"]), rebuilt=rebuilt)
    d["syn"] = [d["open"] + k * UNIT for k in SCHEDULE]
    if rebuilt:
        d["failed"] = max(f for f in lg["iceFailed"] if f <= lg["removal"]["t"]); d["removal"] = lg["removal"]["t"]
        q = next(q for q in lg["resumes"] if q["t"] >= d["removal"]); d["refused"] = q["t"]; d["a2"] = c["actions"][1]["t"]
        d["rebuild"] = next(a["t"] for a in c["actions"] if a["kind"] == "rebuild")
    else:
        d["failed"] = lg["iceFailed"][-1]; d["received"] = accepted(r)["t"]
    return d


def check(a, b):
    bad = []
    k = min(i for i, t in enumerate(a["syn"]) if t > a["restore"])
    if SCHEDULE[k] != 11: bad.append(f"(a) first schedule point after restore is {SCHEDULE[k]} units, not 11")
    if abs(a["received"] - a["syn"][k]) > 0.1: bad.append(f'(a) request received at {a["received"]:.2f}, schedule point at {a["syn"][k]:.2f}')
    if a["received"] - a["failed"] >= 5.0: bad.append("(a) the resume was received 5 s or more after the ICE failure")
    if abs(b["removal"] - b["failed"] - 5.0) > 0.01: bad.append(f'(b) removal {b["removal"] - b["failed"]:.3f} s after ICE failure, not 5.00')
    if abs(b["a1"][1] - b["a1"][0] - 15.0) > 0.05: bad.append(f'(b) first attempt lasted {b["a1"][1] - b["a1"][0]:.2f} s, not 15')
    if any(b["restore"] < t < b["a1"][1] for t in b["syn"]): bad.append("(b) a schedule point falls between restore and the end of the first attempt")
    if not b["removal"] < b["a2"] <= b["refused"] + 0.05: bad.append("(b) the second attempt does not follow the removal")
    if not (0.9 < UNIT < 1.2): bad.append(f"unit {UNIT:.3f} s is not near 1 s")
    if bad: sys.exit("fig2_boundary: the records do not have the shape this figure claims:\n  " + "\n  ".join(bad))


(ra, na), (rb, nb) = pick(18, False), pick(19, True)
A, B = facts(ra, False), facts(rb, True)
check(A, B)
print(f"unit {UNIT:.3f} s from {len(survivors)} survivors | (a) {A['id']} (median of {na}) | (b) {B['id']} (median of {nb})")
for d in (A, B): print({k: (round(v, 2) if isinstance(v, float) else v) for k, v in d.items() if k != "syn"}, "syn", [round(t, 2) for t in d["syn"]])

plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 6.5, "axes.linewidth": 0.5})
XMAX = 30.0
LANES = ["Network", "Client", "Server"]; y = {n: len(LANES) - 1 - i for i, n in enumerate(LANES)}
fig, axes = plt.subplots(2, 1, figsize=(3.5, 2.6), sharex=True)
for ax, d in zip(axes, (A, B)):
    bar = lambda lane, t0, t1, **kw: ax.barh(y[lane], t1 - t0, left=t0, height=0.42, **kw)
    bar("Network", 0, d["restore"], color=GREY, edgecolor="none")
    ax.text(d["restore"] / 2, y["Network"], f'all traffic blocked, {d["D"]} s', ha="center", va="center", color="white", fontsize=6)
    ax.axvline(d["restore"], color=MUTED, lw=0.5, ls=":", zorder=0)
    # client: the first restart attempt and the SYN schedule of its one connection
    ok = not d["rebuilt"]
    bar("Client", d["a1"][0], d["a1"][1], color="#e6effa" if ok else "white", edgecolor=BLUE, linewidth=0.8, hatch=None if ok else "////")
    for k, t in zip(SCHEDULE, d["syn"]):
        if t > XMAX: continue
        if ok and k == 11: ax.plot([d["received"]], [y["Client"]], marker="o", color=BLUE, ms=4.2, zorder=4)
        elif t <= d["a1"][1] and not (ok and t > d["received"]): ax.plot([t], [y["Client"]], marker="o", mfc="white", mec=BLUE, mew=0.8, ms=3.6, zorder=4)
        elif not ok: ax.plot([t], [y["Client"]], marker="o", mfc="white", mec=GREY, mew=0.8, ms=3.6, zorder=4, alpha=0.9)
    if ok:
        ax.text(d["received"] + 0.35, y["Client"] + 0.42, "11th unit: received, accepted", ha="right", va="bottom", color=INK, fontsize=5.5)
    else:
        ax.annotate("", xy=(d["a1"][1], y["Client"] + 0.36), xytext=(d["a1"][0], y["Client"] + 0.36), arrowprops=dict(arrowstyle="<->", color=MUTED, lw=0.5))
        ax.text(sum(d["a1"]) / 2, y["Client"] + 0.42, "attempt abandoned after 15 s", ha="center", va="bottom", color=MUTED, fontsize=5.5)
        t19 = d["syn"][-1]
        ax.text(XMAX - 0.1, y["Client"] + 0.42, "19th unit: never sent", ha="right", va="bottom", color=MUTED, fontsize=5.5)
        ax.plot([d["refused"]], [y["Client"] - 0.36], marker="x", color=BLUE, ms=4.8, mew=1.2, zorder=5)
        ax.text(d["refused"] - 0.6, y["Client"] - 0.42, "2nd attempt", ha="right", va="center", color=INK, fontsize=5.5)
    # server: ICE failure arms the 5 s timer; it ends in a removal, or is cancelled by the resume
    end = d["removal"] if d["rebuilt"] else d["received"]
    bar("Server", d["failed"], end, color="white", edgecolor=ORANGE, linewidth=0.8)
    if not d["rebuilt"]:  # the remainder of the 5 s, which did not run because the resume cancelled the timer
        bar("Server", end, d["failed"] + 5.0, color="none", edgecolor=ORANGE, linewidth=0.7, linestyle=(0, (2.2, 1.6)))
    ax.plot([d["failed"]], [y["Server"]], marker="v", color=ORANGE, ms=4.5, zorder=3)
    ax.text(d["failed"] - 0.5, y["Server"], "ICE failed", ha="right", va="center", color=INK, fontsize=5.5)
    if d["rebuilt"]:
        ax.plot([d["removal"]], [y["Server"]], marker="D", color=ORANGE, ms=3.8, zorder=4)
        ax.text((d["failed"] + end) / 2, y["Server"], "5 s", ha="center", va="center", color=INK, fontsize=5.5)
        ax.text(d["removal"] + 0.6, y["Server"], "participant removed", ha="left", va="center", color=INK, fontsize=5.5)
    else:
        ax.text(d["failed"] + 5.0 + 0.5, y["Server"], "cancelled at %.1f s" % (end - d["failed"]), ha="left", va="center", color=INK, fontsize=5.5)
    ax.set_title(("(a) 18 s outage: a request arrives in time  →  session survives" if ok else "(b) 19 s outage: no request can arrive in time  →  session rebuilt"), loc="left", fontsize=6.5, pad=3, color=INK)
    ax.set_yticks([y[n] for n in LANES]); ax.set_yticklabels(LANES, fontsize=6); ax.set_ylim(-0.75, len(LANES) - 0.2); ax.set_xlim(0, XMAX)
    ax.tick_params(length=2, width=0.5); ax.set_axisbelow(True); ax.xaxis.grid(True, color="#ecebe6", lw=0.4)
    for s in ("top", "right"): ax.spines[s].set_visible(False)
axes[-1].set_xlabel("seconds after isolation onset", fontsize=6.5)
fig.legend(handles=[Line2D([], [], marker="o", mfc="white", mec=BLUE, mew=0.8, ls="none", ms=3.6, label="connection request per kernel schedule (not observed)"),
                    Line2D([], [], marker="o", color=BLUE, ls="none", ms=4.2, label="request received by server (observed)"),
                    Line2D([], [], marker="x", color=BLUE, ls="none", ms=4.8, mew=1.2, label="request refused (observed)"),
                    Patch(facecolor="white", edgecolor=ORANGE, label="server's 5 s disconnect timer")],
           loc="lower left", bbox_to_anchor=(0.01, 0.0), ncol=2, frameon=False, fontsize=5.2, handlelength=1.4, columnspacing=0.8, labelspacing=0.3, borderaxespad=0.1)
fig.subplots_adjust(left=0.135, right=0.985, top=0.935, bottom=0.245, hspace=0.46)
out = os.path.join(HERE, "fig2_boundary")
fig.savefig(out + ".pdf", metadata={"CreationDate": None}); fig.savefig(out + ".png", dpi=300)
