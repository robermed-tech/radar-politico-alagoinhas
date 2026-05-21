import { useState, useEffect, useRef } from "react";

// ── DADOS MOCKADOS ──────────────────────────────────────────
const BARS = [
  { d: "S", h: 28 }, { d: "M", h: 52 }, { d: "T", h: 44 },
  { d: "W", h: 63 }, { d: "T", h: 100, tip: "5h 23m", active: true },
  { d: "F", h: 57 }, { d: "S", h: 22 },
];

const TASKS = [
  { icon: "💬", name: "Interview", time: "Sep 13, 08:30", done: true },
  { icon: "⚡", name: "Team Meeting", time: "Sep 13, 10:30", done: true },
  { icon: "📁", name: "Project Update", time: "Sep 13, 13:00", done: false },
  { icon: "✏️", name: "Discuss Q3 Goals", time: "Sep 13, 14:45", done: false },
  { icon: "📋", name: "HR Policy Review", time: "Sep 13, 16:30", done: false },
];

const NAV = ["Dashboard", "People", "Hiring", "Devices", "Apps", "Salary", "Calendar", "Reviews"];

const EVENTS = [
  { col: 3, row: 1, span: 2, title: "Weekly Team Sync", sub: "Discuss progress on projects", avatars: ["A", "B", "C"] },
  { col: 4, row: 3, span: 2, title: "Onboarding Session", sub: "Introduction for new hires", avatars: ["D", "E"] },
];

const ACCORDION = [
  { label: "Pension contributions", open: false },
  {
    label: "Devices", open: true,
    content: { icon: "💻", name: "MacBook Air", sub: "Version M1" }
  },
  { label: "Compensation Summary", open: false },
  { label: "Employee Benefits", open: false },
];

// ── UTILITÁRIOS ──────────────────────────────────────────────
function useCounter(target, duration = 1200) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let start = null;
    const step = (ts) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setVal(Math.floor(ease * target));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration]);
  return val;
}

// ── COMPONENTES ──────────────────────────────────────────────

function Navbar() {
  return (
    <nav style={{
      background: "rgba(255,255,255,0.92)",
      backdropFilter: "blur(12px)",
      borderBottom: "1px solid #E8E4DC",
      padding: "0 28px",
      height: 60,
      display: "flex",
      alignItems: "center",
      gap: 28,
      position: "sticky",
      top: 0,
      zIndex: 100,
    }}>
      <div style={{
        border: "1.5px solid #E8E4DC",
        borderRadius: 10,
        padding: "6px 16px",
        fontWeight: 700,
        fontSize: 15,
        fontFamily: "'DM Sans', sans-serif",
        letterSpacing: "-0.3px",
      }}>Crextio</div>

      <div style={{ display: "flex", gap: 2, flex: 1 }}>
        {NAV.map(n => (
          <div key={n} style={{
            padding: "6px 13px",
            borderRadius: 100,
            fontSize: 13,
            fontWeight: n === "Dashboard" ? 600 : 400,
            background: n === "Dashboard" ? "#1C1C1C" : "transparent",
            color: n === "Dashboard" ? "#fff" : "#6B6B6B",
            cursor: "pointer",
            transition: "background 0.15s",
            whiteSpace: "nowrap",
          }}>{n}</div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <span style={{ fontSize: 18, cursor: "pointer", opacity: 0.5 }}>⚙️</span>
        <span style={{ fontSize: 18, cursor: "pointer", opacity: 0.5 }}>🔔</span>
        <div style={{
          width: 30, height: 30,
          borderRadius: "50%",
          background: "#F5C842",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 700, fontSize: 13, color: "#1C1C1C",
        }}>N</div>
      </div>
    </nav>
  );
}

function Hero() {
  const emp = useCounter(78);
  const hir = useCounter(56);
  const proj = useCounter(203);

  return (
    <section style={{
      background: "linear-gradient(135deg, #FFFFFF 0%, #FDF3C0 55%, #FAE97A 100%)",
      padding: "30px 28px 24px",
    }}>
      <h1 style={{
        fontFamily: "'DM Sans', sans-serif",
        fontSize: 42,
        fontWeight: 700,
        color: "#1A1A1A",
        letterSpacing: "-1px",
        marginBottom: 22,
      }}>Welcome in, Nixtio</h1>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {/* Pills */}
        {[
          { label: "Interviews", value: "15%", dark: true },
          { label: "Hired", value: "15%", yellow: true },
        ].map(p => (
          <div key={p.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "#A0A0A0", fontWeight: 500 }}>{p.label}</span>
            <div style={{
              borderRadius: 100, height: 32, padding: "0 16px",
              display: "flex", alignItems: "center",
              background: p.dark ? "#1C1C1C" : p.yellow ? "#F5C842" : "transparent",
              color: p.dark ? "#fff" : "#1C1C1C",
              fontWeight: 600, fontSize: 13,
            }}>{p.value}</div>
          </div>
        ))}

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: "#A0A0A0", fontWeight: 500 }}>Project time</span>
          <div style={{
            borderRadius: 100, height: 32, padding: "0 14px",
            display: "flex", alignItems: "center", gap: 8,
            border: "1.5px solid #E8E4DC", background: "transparent",
          }}>
            <div style={{ width: 80, height: 5, borderRadius: 3, background: "#E8E4DC", overflow: "hidden" }}>
              <div style={{ width: "60%", height: "100%", background: "#1C1C1C", borderRadius: 3 }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#6B6B6B" }}>60%</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: "#A0A0A0", fontWeight: 500 }}>Output</span>
          <div style={{
            borderRadius: 100, height: 32, padding: "0 16px",
            display: "flex", alignItems: "center",
            border: "1.5px solid #E8E4DC", background: "transparent",
            fontSize: 12, fontWeight: 600, color: "#6B6B6B",
          }}>10%</div>
        </div>

        {/* Números grandes */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 36, alignItems: "center" }}>
          {[
            { val: emp, label: "Employée" },
            { val: hir, label: "Hirings" },
            { val: proj, label: "Projects" },
          ].map(s => (
            <div key={s.label}>
              <div style={{ fontSize: 44, fontWeight: 300, lineHeight: 1, color: "#1A1A1A" }}>{s.val}</div>
              <div style={{ fontSize: 11, color: "#A0A0A0", fontWeight: 500, marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Card({ children, dark, style = {} }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: dark ? "#1C1C1C" : "#fff",
        borderRadius: 20,
        padding: "20px 20px",
        boxShadow: hov && !dark ? "0 6px 24px rgba(0,0,0,0.10)" : "0 2px 12px rgba(0,0,0,0.06)",
        border: dark ? "none" : "1px solid #E8E4DC",
        transform: hov && !dark ? "translateY(-2px)" : "translateY(0)",
        transition: "all 0.22s ease",
        ...style,
      }}>
      {children}
    </div>
  );
}

function CardHeader({ title, dark }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
      <span style={{ fontSize: 14, fontWeight: 600, color: dark ? "#fff" : "#1A1A1A" }}>{title}</span>
      <button style={{
        width: 26, height: 26, borderRadius: 8,
        border: `1px solid ${dark ? "rgba(255,255,255,0.15)" : "#E8E4DC"}`,
        background: "transparent", cursor: "pointer", fontSize: 11,
        color: dark ? "rgba(255,255,255,0.5)" : "#6B6B6B",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>↗</button>
    </div>
  );
}

function ProfileCard() {
  return (
    <div style={{
      background: "linear-gradient(180deg, #EDE8DF 0%, #D8D3CA 100%)",
      borderRadius: 20, overflow: "hidden",
      boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
      border: "1px solid #E0DBD2",
    }}>
      <div style={{
        width: "100%", height: 155,
        background: "linear-gradient(160deg, #C8BFB0 0%, #A8A098 100%)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 64, userSelect: "none",
      }}>👩</div>
      <div style={{
        padding: "12px 14px 16px",
        display: "flex", justifyContent: "space-between", alignItems: "flex-end",
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#1A1A1A" }}>Lora Piterson</div>
          <div style={{ fontSize: 11, color: "#D4A800", fontWeight: 500, marginTop: 2 }}>UX/UI Designer</div>
        </div>
        <div style={{
          background: "rgba(255,255,255,0.8)",
          backdropFilter: "blur(8px)",
          borderRadius: 100, padding: "5px 13px",
          fontSize: 13, fontWeight: 700, color: "#1A1A1A",
        }}>$1,200</div>
      </div>
    </div>
  );
}

function ProgressCard() {
  return (
    <Card>
      <CardHeader title="Progress" />
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 30, fontWeight: 700, color: "#1A1A1A", lineHeight: 1 }}>6.1 h</span>
        <span style={{ fontSize: 11, color: "#A0A0A0", lineHeight: 1.3 }}>Work Time<br />this week</span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 80, marginTop: 14 }}>
        {BARS.map((b, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, height: "100%" }}>
            <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "flex-end", position: "relative" }}>
              {b.tip && (
                <div style={{
                  position: "absolute", top: -24, left: "50%", transform: "translateX(-50%)",
                  background: "#F5C842", color: "#1C1C1C",
                  fontSize: 10, fontWeight: 700, padding: "2px 8px",
                  borderRadius: 20, whiteSpace: "nowrap",
                }}>{b.tip}</div>
              )}
              <div style={{
                width: "100%",
                height: `${b.h}%`,
                borderRadius: "5px 5px 0 0",
                background: b.active ? "#1C1C1C" : "#E8E4DC",
                transition: "height 0.5s cubic-bezier(0.34,1.56,0.64,1)",
              }} />
            </div>
            <div style={{ width: 4, height: 4, borderRadius: "50%", background: "#C8C4BC" }} />
            <div style={{ fontSize: 11, color: "#A0A0A0", fontWeight: 500 }}>{b.d}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function TimeTracker() {
  const [running, setRunning] = useState(false);
  const [secs, setSecs] = useState(155);
  const ref = useRef(null);

  useEffect(() => {
    if (running) ref.current = setInterval(() => setSecs(s => s + 1), 1000);
    else clearInterval(ref.current);
    return () => clearInterval(ref.current);
  }, [running]);

  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  const pct = Math.min((secs / 600) * 100, 100);
  const circ = 100;
  const offset = circ - (pct / 100) * circ;

  return (
    <Card style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <CardHeader title="Time tracker" />
      <div style={{ position: "relative", width: 110, height: 110 }}>
        <svg viewBox="0 0 36 36" style={{ width: "100%", height: "100%", transform: "rotate(-90deg)" }}>
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="#E8E4DC" strokeWidth="3" />
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="#F5C842" strokeWidth="3"
            strokeDasharray={`${pct} ${100 - pct}`}
            strokeLinecap="round"
            style={{ transition: "stroke-dasharray 0.3s ease" }}
          />
        </svg>
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
        }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: "#1A1A1A", lineHeight: 1 }}>{mm}:{ss}</span>
          <span style={{ fontSize: 10, color: "#A0A0A0", marginTop: 2 }}>Work Time</span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 16 }}>
        {[
          { icon: running ? "⏸" : "▶", onClick: () => setRunning(r => !r) },
          { icon: "⏹", onClick: () => { setRunning(false); setSecs(0); } },
        ].map((b, i) => (
          <button key={i} onClick={b.onClick} style={{
            width: 34, height: 34, borderRadius: "50%",
            border: "1.5px solid #E8E4DC", background: "transparent",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", fontSize: 13, color: "#1A1A1A",
          }}>{b.icon}</button>
        ))}
        <button style={{
          width: 34, height: 34, borderRadius: "50%",
          border: "none", background: "#1C1C1C",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", fontSize: 13,
        }}>⏰</button>
      </div>
    </Card>
  );
}

function OnboardingCard() {
  const [tasks, setTasks] = useState(TASKS);
  const done = tasks.filter(t => t.done).length;
  const pct = Math.round((done / tasks.length) * 100);

  return (
    <Card dark>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>Onboarding</span>
        <span style={{ fontSize: 28, fontWeight: 300, color: "#fff" }}>{pct}%</span>
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {["30%", "25%", "0%"].map(l => (
          <span key={l} style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", flex: 1 }}>{l}</span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 5, height: 7, marginBottom: 12 }}>
        {[
          { flex: 30, bg: "#F5C842" },
          { flex: 25, bg: "rgba(255,255,255,0.25)" },
          { flex: 45, bg: "rgba(255,255,255,0.08)" },
        ].map((s, i) => (
          <div key={i} style={{ flex: s.flex, background: s.bg, borderRadius: 100, height: "100%" }} />
        ))}
      </div>

      <div style={{
        background: "rgba(0,0,0,0.4)", borderRadius: 14,
        padding: "12px 14px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#fff" }}>Onboarding Task</span>
          <span style={{ fontSize: 20, fontWeight: 300, color: "#fff" }}>{done}/{tasks.length}</span>
        </div>
        {tasks.map((t, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "7px 0",
            borderBottom: i < tasks.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none",
          }}>
            <div style={{
              width: 26, height: 26, borderRadius: "50%",
              background: "rgba(255,255,255,0.08)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, flexShrink: 0,
            }}>{t.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: "rgba(255,255,255,0.85)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{t.time}</div>
            </div>
            <div
              onClick={() => setTasks(ts => ts.map((x, j) => j === i ? { ...x, done: !x.done } : x))}
              style={{
                width: 18, height: 18, borderRadius: "50%",
                border: t.done ? "none" : "1.5px solid rgba(255,255,255,0.2)",
                background: t.done ? "#F5C842" : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, color: "#1C1C1C", cursor: "pointer",
                flexShrink: 0,
              }}>{t.done ? "✓" : ""}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SidebarCard() {
  const [open, setOpen] = useState({ 1: true });
  return (
    <Card style={{ height: "fit-content" }}>
      {ACCORDION.map((item, i) => (
        <div key={i} style={{ borderBottom: i < ACCORDION.length - 1 ? "1px solid #E8E4DC" : "none" }}>
          <div
            onClick={() => setOpen(o => ({ ...o, [i]: !o[i] }))}
            style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "13px 0", cursor: "pointer",
              fontSize: 13, fontWeight: 500, color: "#1A1A1A",
            }}>
            {item.label}
            <span style={{
              fontSize: 11, color: "#A0A0A0",
              transform: open[i] ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.2s", display: "inline-block",
            }}>∨</span>
          </div>
          {open[i] && item.content && (
            <div style={{ paddingBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 38, height: 38, borderRadius: 9,
                  background: "#F0EDE6",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 18,
                }}>{item.content.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "#1A1A1A" }}>{item.content.name}</div>
                  <div style={{ fontSize: 11, color: "#A0A0A0" }}>{item.content.sub}</div>
                </div>
                <span style={{ color: "#A0A0A0", cursor: "pointer", fontSize: 14 }}>···</span>
              </div>
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}

function CalendarCard() {
  const days = [
    { day: "Mon", date: 22 }, { day: "Tue", date: 23 },
    { day: "Wed", date: 24, today: true }, { day: "Thu", date: 25 },
    { day: "Fri", date: 26 }, { day: "Sat", date: 27 },
  ];
  const times = ["8:00 am", "9:00 am", "10:00 am", "11:00 am"];

  // events: { timeIdx, colIdx, span, title, sub, avatars }
  const evts = [
    { timeIdx: 0, colIdx: 2, span: 2, title: "Weekly Team Sync", sub: "Discuss progress on projects", avatars: ["A","B","C"], colors: ["#F5C842","#C8BFB0","#A0D4B0"] },
    { timeIdx: 2, colIdx: 3, span: 2, title: "Onboarding Session", sub: "Introduction for new hires", avatars: ["D","E"], colors: ["#F5A842","#A0B4D4"] },
  ];

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontSize: 13, color: "#A0A0A0", cursor: "pointer" }}>August</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#1A1A1A" }}>September 2024</span>
        <span style={{ fontSize: 13, color: "#D4A800", fontWeight: 600, cursor: "pointer" }}>October</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "62px repeat(6, 1fr)", fontSize: 11 }}>
        {/* Header */}
        <div />
        {days.map(d => (
          <div key={d.date} style={{ textAlign: "center", padding: "4px 2px 10px", color: "#A0A0A0", fontWeight: 500 }}>
            <div>{d.day}</div>
            <div style={{
              display: "inline-flex", width: 22, height: 22,
              borderRadius: "50%",
              background: d.today ? "#1C1C1C" : "transparent",
              color: d.today ? "#fff" : "#6B6B6B",
              alignItems: "center", justifyContent: "center",
              fontWeight: d.today ? 700 : 400, marginTop: 2,
            }}>{d.date}</div>
          </div>
        ))}

        {/* Rows */}
        {times.map((time, ti) => (
          <>
            <div key={`t${ti}`} style={{
              height: 56, display: "flex", alignItems: "flex-start",
              paddingTop: 5, color: "#A0A0A0", fontSize: 10,
            }}>{time}</div>
            {days.map((d, di) => {
              const evt = evts.find(e => e.timeIdx === ti && e.colIdx === di);
              if (evt) return (
                <div key={`c${ti}-${di}`} style={{
                  gridColumn: `span ${evt.span}`,
                  borderLeft: "1px solid #E8E4DC",
                  borderTop: "1px solid #E8E4DC",
                  height: 56, padding: 3,
                }}>
                  <div style={{
                    background: "#1C1C1C", borderRadius: 9,
                    padding: "7px 9px", height: "100%",
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#fff" }}>{evt.title}</div>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.45)", marginTop: 1 }}>{evt.sub}</div>
                    <div style={{ display: "flex", marginTop: 4 }}>
                      {evt.avatars.map((av, ai) => (
                        <div key={ai} style={{
                          width: 15, height: 15, borderRadius: "50%",
                          border: "1.5px solid #1C1C1C",
                          background: evt.colors[ai],
                          marginLeft: ai > 0 ? -5 : 0,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 7, fontWeight: 700, color: "#1A1A1A",
                        }}>{av}</div>
                      ))}
                    </div>
                  </div>
                </div>
              );
              // check if this col is covered by a spanning event
              const covered = evts.some(e => e.timeIdx === ti && di > e.colIdx && di < e.colIdx + e.span);
              if (covered) return null;
              return (
                <div key={`c${ti}-${di}`} style={{
                  borderLeft: "1px solid #E8E4DC",
                  borderTop: "1px solid #E8E4DC",
                  height: 56,
                }} />
              );
            })}
          </>
        ))}
      </div>
    </Card>
  );
}

// ── MAIN ─────────────────────────────────────────────────────
export default function Dashboard() {
  return (
    <div style={{
      fontFamily: "'DM Sans', sans-serif",
      background: "#F7F5F0",
      minHeight: "100vh",
      color: "#1A1A1A",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        button { font-family: inherit; }
      `}</style>

      <Navbar />
      <Hero />

      {/* Grid superior */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "190px 1fr 1fr 250px",
        gap: 14,
        padding: "18px 28px 0",
      }}>
        <ProfileCard />
        <ProgressCard />
        <TimeTracker />
        <OnboardingCard />
      </div>

      {/* Grid inferior */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "250px 1fr",
        gap: 14,
        padding: "14px 28px 28px",
      }}>
        <SidebarCard />
        <CalendarCard />
      </div>
    </div>
  );
}
