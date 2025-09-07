import React, { useEffect, useMemo, useRef, useState } from 'react'

const formatTime = (totalSeconds) => {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(minutes)}:${pad(seconds)}`
}

// Play repeated short beeps over a given duration (~3s default)
const playBeepSequence = (audioCtx, totalDurationSec = 3) => {
  if (!audioCtx) return
  const now = audioCtx.currentTime
  const beepDuration = 0.12
  const gap = 0.08
  const step = beepDuration + gap
  let t = 0
  let idx = 0

  while (t < totalDurationSec) {
    const freq = idx % 2 === 0 ? 880 : 660
    const startAt = now + t
    const endAt = startAt + beepDuration

    const oscillator = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = freq
    oscillator.connect(gain)
    gain.connect(audioCtx.destination)

    gain.gain.setValueAtTime(0.0001, startAt)
    gain.gain.exponentialRampToValueAtTime(0.18, startAt + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, endAt)

    oscillator.start(startAt)
    oscillator.stop(endAt)

    t += step
    idx += 1
  }
}

const showNotification = (title, body) => {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission === 'granted') {
    try { new Notification(title, { body }) } catch (_) {}
  } else if (Notification.permission === 'default') {
    Notification.requestPermission().then((perm) => {
      if (perm === 'granted') {
        try { new Notification(title, { body }) } catch (_) {}
      }
    })
  }
}

export default function App() {
  const [inputMinutes, setInputMinutes] = useState(25)
  const [inputSeconds, setInputSeconds] = useState(0)
  const [remainingSeconds, setRemainingSeconds] = useState(25 * 60)
  const [isRunning, setIsRunning] = useState(false)

  const [sessions, setSessions] = useState([])
  const [isNoteOpen, setIsNoteOpen] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [noteTagsText, setNoteTagsText] = useState('')
  const [pendingSession, setPendingSession] = useState(null)
  const [runStartAt, setRunStartAt] = useState(null)
  const [plannedSeconds, setPlannedSeconds] = useState(25 * 60)

  const [hasHydratedState, setHasHydratedState] = useState(false)
  const [hasHydratedSessions, setHasHydratedSessions] = useState(false)

  const [isEditOpen, setIsEditOpen] = useState(false)
  const [editingSession, setEditingSession] = useState(null)
  const [editNoteText, setEditNoteText] = useState('')
  const [editTagsText, setEditTagsText] = useState('')
  const [reportSelection, setReportSelection] = useState(null)
  const pieWrapRef = useRef(null)

  const initialSeconds = useMemo(() => inputMinutes * 60 + inputSeconds, [inputMinutes, inputSeconds])
  const intervalRef = useRef(null)
  const audioCtxRef = useRef(null)

  // Helper to persist both state and sessions immediately
  const persistAll = (override = {}) => {
    try {
      localStorage.setItem(
        'pomodoro:state',
        JSON.stringify({
          inputMinutes,
          inputSeconds,
          remainingSeconds,
          isRunning,
          runStartAt,
          plannedSeconds,
          pendingSession,
          isNoteOpen,
          noteText,
          noteTagsText,
          updatedAt: Date.now(),
          ...override
        })
      )
    } catch (_) {}
    try {
      localStorage.setItem('pomodoro:sessions', JSON.stringify(sessions))
    } catch (_) {}
  }

  // Restore state on first load
  useEffect(() => {
    let initialized = false
    try {
      const saved = JSON.parse(localStorage.getItem('pomodoro:state') || 'null')
      if (saved && typeof saved === 'object') {
        const m = Number(saved.inputMinutes) || 0
        const s = Math.min(59, Math.max(0, Number(saved.inputSeconds) || 0))
        setInputMinutes(m)
        setInputSeconds(s)
        const planned = Number(saved.plannedSeconds) || m * 60 + s
        setPlannedSeconds(planned)

        // Restore any pending session/modal state
        if (saved.pendingSession) {
          setPendingSession(saved.pendingSession)
          setIsNoteOpen(!!saved.isNoteOpen)
          setNoteText(String(saved.noteText || ''))
          setNoteTagsText(String(saved.noteTagsText || ''))
        }

        const wasRunning = !!saved.isRunning
        const savedRunStartAt = Number(saved.runStartAt) || null
        if (wasRunning && savedRunStartAt) {
          const now = Date.now()
          const elapsed = Math.floor((now - savedRunStartAt) / 1000)
          const remaining = Math.max(0, planned - elapsed)
          setRemainingSeconds(remaining)
          if (remaining > 0) {
            setRunStartAt(savedRunStartAt)
            setIsRunning(true)
          } else {
            const endedAt = savedRunStartAt + planned * 1000
            setPendingSession((prev) => prev || {
              id: String(endedAt) + '-' + Math.random().toString(36).slice(2),
              startedAt: savedRunStartAt,
              endedAt,
              durationSeconds: Math.max(0, Math.round((endedAt - savedRunStartAt) / 1000)),
              note: '',
              tags: []
            })
            setNoteText((t) => t || '')
            setNoteTagsText((t) => t || '')
            setIsNoteOpen(true)
            setRunStartAt(null)
            setIsRunning(false)
          }
        } else {
          const rem = Number(saved.remainingSeconds)
          setRemainingSeconds(Number.isFinite(rem) ? Math.max(0, rem) : planned)
          setRunStartAt(null)
          setIsRunning(false)
        }
        initialized = true
      }
    } catch (_) {}

    if (!initialized) {
      // Fallback defaults if nothing saved
      if (inputMinutes === 25 && inputSeconds === 0) { setInputMinutes(25)
      setInputSeconds(0)
      setRemainingSeconds(25 * 60)
      setPlannedSeconds(25 * 60) } else { setIsRunning(false); setRunStartAt(null) }
    }

    setHasHydratedState(true)
  }, [])

  // Load saved sessions on first load
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('pomodoro:sessions') || '[]')
      if (Array.isArray(saved)) setSessions(saved)
    } catch (_) {}
    setHasHydratedSessions(true)
  }, [])

  // Persist sessions (only after hydration)
  useEffect(() => {
    if (!hasHydratedSessions) return
    try {
      localStorage.setItem('pomodoro:sessions', JSON.stringify(sessions))
    } catch (_) {}
  }, [sessions, hasHydratedSessions])

  // Persist timer state (only after hydration)
  useEffect(() => {
    if (!hasHydratedState) return
    try {
      localStorage.setItem(
        'pomodoro:state',
        JSON.stringify({
          inputMinutes,
          inputSeconds,
          remainingSeconds,
          isRunning,
          runStartAt,
          plannedSeconds,
          pendingSession,
          isNoteOpen,
          noteText,
          noteTagsText,
          updatedAt: Date.now()
        })
      )
    } catch (_) {}
  }, [hasHydratedState, inputMinutes, inputSeconds, remainingSeconds, isRunning, runStartAt, plannedSeconds, pendingSession, isNoteOpen, noteText, noteTagsText])

  // Persist on page hide/unload
  useEffect(() => {
    const handlePersist = () => {
      persistAll()
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') handlePersist()
    }
    window.addEventListener('beforeunload', handlePersist)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('beforeunload', handlePersist)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [inputMinutes, inputSeconds, remainingSeconds, isRunning, runStartAt, plannedSeconds, pendingSession, isNoteOpen, noteText, noteTagsText, sessions])

  // Run ticking interval
  useEffect(() => {
    if (!isRunning) return

    intervalRef.current = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
          setIsRunning(false)
          // notify and sound
          try { audioCtxRef.current && audioCtxRef.current.resume && audioCtxRef.current.resume() } catch (_) {}
          playBeepSequence(audioCtxRef.current)
          if (navigator.vibrate) { try { navigator.vibrate([250, 100, 250]) } catch (_) {} }
          showNotification("Time's up!", 'Your pomodoro session has finished.')
          const previousTitle = document.title
          document.title = "Time's up! - Pomodoro"
          setTimeout(() => { document.title = previousTitle }, 8000)

          // mark session completed and open note dialog
          const endedAt = Date.now()
          const startedAt = runStartAt ?? endedAt - plannedSeconds * 1000
          const newPending = {
            id: String(endedAt) + '-' + Math.random().toString(36).slice(2),
            startedAt,
            endedAt,
            durationSeconds: Math.max(0, Math.round((endedAt - startedAt) / 1000)),
            note: '',
            tags: []
          }
          setPendingSession(newPending)
          setNoteText('')
          setNoteTagsText('')
          setIsNoteOpen(true)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [isRunning, plannedSeconds, runStartAt])

  const handleStart = () => {
    if (remainingSeconds <= 0) {
      setRemainingSeconds(initialSeconds)
    }
    if (!runStartAt) {
      setRunStartAt(Date.now())
      setPlannedSeconds(remainingSeconds > 0 ? remainingSeconds : initialSeconds)
    }
    // prepare audio context and request notification permission
    try {
      if (!audioCtxRef.current) {
        const Ctx = window.AudioContext || window.webkitAudioContext
        if (Ctx) audioCtxRef.current = new Ctx()
      }
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {})
      }
    } catch (_) {}
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      try { Notification.requestPermission().catch(() => {}) } catch (_) {}
    }
    setIsRunning(true)
  }

  const handleStop = () => {
    setIsRunning(false)
  }

  const handleReset = () => {
    setIsRunning(false)
    setRemainingSeconds(initialSeconds)
    setRunStartAt(null)
    setPlannedSeconds(initialSeconds)
  }

  const handleApplyTime = () => {
    const total = Math.max(0, initialSeconds)
    // reset to applied time and auto start if > 0
    setIsRunning(false)
    setRemainingSeconds(total)
    const now = Date.now()
    setRunStartAt(total > 0 ? now : null)
    setPlannedSeconds(total)
    if (total > 0) {
      try {
        if (!audioCtxRef.current) {
          const Ctx = window.AudioContext || window.webkitAudioContext
          if (Ctx) audioCtxRef.current = new Ctx()
        }
        if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
          audioCtxRef.current.resume().catch(() => {})
        }
      } catch (_) {}
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
        try { Notification.requestPermission().catch(() => {}) } catch (_) {}
      }
      setIsRunning(true)
    }
  }

  // Start immediately with a fixed number of seconds (updates inputs and starts timer)
  const startPreset = (totalSeconds) => {
    const total = Math.max(0, Number(totalSeconds) || 0)
    const mins = Math.floor(total / 60)
    const secs = total % 60

    setIsRunning(false)
    setInputMinutes(mins)
    setInputSeconds(secs)
    setRemainingSeconds(total)
    const now = Date.now()
    setRunStartAt(total > 0 ? now : null)
    setPlannedSeconds(total)

    if (total > 0) {
      try {
        if (!audioCtxRef.current) {
          const Ctx = window.AudioContext || window.webkitAudioContext
          if (Ctx) audioCtxRef.current = new Ctx()
        }
        if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
          audioCtxRef.current.resume().catch(() => {})
        }
      } catch (_) {}
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
        try { Notification.requestPermission().catch(() => {}) } catch (_) {}
      }
      setIsRunning(true)
    }
  }

  const [activeTab, setActiveTab] = useState('pomodoro')
  const switchTab = (mode) => {
    setActiveTab(mode)
    if (mode === 'pomodoro') {
      // Set default Pomodoro time without auto-start
      setIsRunning(false)
      if (inputMinutes === 25 && inputSeconds === 0) { setInputMinutes(25)
      setInputSeconds(0)
      setRemainingSeconds(25 * 60)
      setRunStartAt(null)
      setPlannedSeconds(25 * 60) } else { setIsRunning(false); setRunStartAt(null) }
    } else if (mode === 'short') {
      startPreset(5 * 60)
    } else if (mode === 'long') {
      startPreset(10 * 60)
    } else if (mode === 'report') {
      // Do not start any timers on the Report tab
      setIsRunning(false)
    }
  }

  const saveSession = (withNote) => {
    if (!pendingSession) return
    if (withNote) {
      const note = noteText.trim()
      const tags = noteTagsText
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
      const finalized = { ...pendingSession, note, tags }
      const nextSessions = [finalized, ...sessions]
      setSessions(nextSessions)
      try { localStorage.setItem('pomodoro:sessions', JSON.stringify(nextSessions)) } catch (_) {}
    }
    setPendingSession(null)
    setIsNoteOpen(false)
    setNoteText('')
    setNoteTagsText('')
    setRunStartAt(null)
    persistAll({ pendingSession: null, isNoteOpen: false, noteText: '' })
  }

  const startEditSession = (session) => {
    setEditingSession(session)
    setEditNoteText(session.note || '')
    setEditTagsText(Array.isArray(session.tags) ? session.tags.join(', ') : '')
    setIsEditOpen(true)
  }

  const saveEditSession = () => {
    if (!editingSession) return
    const updated = {
      ...editingSession,
      note: (editNoteText || '').trim(),
      tags: (editTagsText || '')
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
    }
    const next = sessions.map((s) => (s.id === updated.id ? updated : s))
    setSessions(next)
    try { localStorage.setItem('pomodoro:sessions', JSON.stringify(next)) } catch (_) {}
    setIsEditOpen(false)
    setEditingSession(null)
    setEditNoteText('')
    setEditTagsText('')
  }

  const deleteSession = (id) => {
    const confirmed = typeof window !== 'undefined' ? window.confirm('Delete this session? This cannot be undone.') : true
    if (!confirmed) return
    const next = sessions.filter((s) => s.id !== id)
    setSessions(next)
    try { localStorage.setItem('pomodoro:sessions', JSON.stringify(next)) } catch (_) {}
    if (editingSession && editingSession.id === id) {
      setIsEditOpen(false)
      setEditingSession(null)
      setEditNoteText('')
      setEditTagsText('')
    }
  }

  return (
    <div className="app">

      <div className="tabs" role="tablist" aria-label="Timer modes">
        <button
          role="tab"
          aria-selected={activeTab === 'pomodoro'}
          className={activeTab === 'pomodoro' ? 'active' : ''}
          onClick={() => switchTab('pomodoro')}
        >Pomodoro</button>
        <button
          role="tab"
          aria-selected={activeTab === 'short'}
          className={activeTab === 'short' ? 'active' : ''}
          onClick={() => switchTab('short')}
        >Short break</button>
        <button
          role="tab"
          aria-selected={activeTab === 'long'}
          className={activeTab === 'long' ? 'active' : ''}
          onClick={() => switchTab('long')}
        >Long break</button>
        <button
          role="tab"
          aria-selected={activeTab === 'report'}
          className={activeTab === 'report' ? 'active' : ''}
          onClick={() => switchTab('report')}
        >Report</button>
      </div>

      {activeTab !== 'report' && (
        <div className="timer-display" aria-live="polite">{formatTime(remainingSeconds)}</div>
      )}

      {activeTab !== 'report' && (
        <div className="controls">
          <button onClick={handleStart} disabled={isRunning}>Start</button>
          <button onClick={handleStop} disabled={!isRunning}>Stop</button>
          <button onClick={handleReset}>Reset</button>
        </div>
      )}

      {activeTab !== 'report' && (
        <div className="time-inputs">
          <label>
            Minutes
            <input
              type="number"
              min="0"
              value={inputMinutes}
              onChange={(e) => setInputMinutes(Number(e.target.value) || 0)}
            />
          </label>
          <label>
            Seconds
            <input
              type="number"
              min="0"
              max="59"
              value={inputSeconds}
              onChange={(e) => {
                const v = Math.min(59, Math.max(0, Number(e.target.value) || 0))
                setInputSeconds(v)
              }}
            />
          </label>
          <button onClick={handleApplyTime}>Apply</button>
        </div>
      )}

      {activeTab === 'report' && (() => {
        const now = new Date()
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
        const end = start + 24 * 60 * 60 * 1000
        const todays = sessions.filter((s) => {
          const t = Number(s.endedAt) || 0
          return t >= start && t < end
        })
        const totals = todays.reduce((acc, s) => {
          const name = (s.note && s.note.trim().length > 0) ? s.note.trim() : '(no name)'
          const dur = Number(s.durationSeconds) || 0
          acc[name] = (acc[name] || 0) + dur
          return acc
        }, {})
        // Normalize keys to the exact display label used later to avoid mismatch
        const normalizeName = (name) => {
          const n = (name || '').trim()
          return n.length > 0 ? n : '(no name)'
        }
        const normalizedTotals = Object.entries(totals).reduce((acc, [k, v]) => {
          const key = normalizeName(k)
          acc[key] = (acc[key] || 0) + v
          return acc
        }, {})
        const entries = Object.entries(normalizedTotals).sort((a, b) => (b[1] - a[1]))
        const totalSum = entries.reduce((n, [, v]) => n + v, 0)
        if (totalSum === 0) return (
          <section className="pie">
            <h3>Time by session</h3>
            <p className="muted">No data yet.</p>
          </section>
        )
        const palette = ['#22c55e', '#60a5fa', '#f59e0b', '#a78bfa', '#f472b6', '#34d399', '#f87171', '#38bdf8', '#eab308', '#10b981']
        // Build segments with small gaps (degrees)
        const gapDeg = 2
        let accDeg = 0
        const segments = entries.map(([label, value], idx) => {
          const sweep = (value / totalSum) * 360
          const color = palette[idx % palette.length]
          const start = accDeg
          const end = start + Math.max(0, sweep - gapDeg)
          accDeg = start + sweep
          const mid = (start + end) / 2
          return { label, value, color, start, end, mid }
        })
        const gradientParts = []
        segments.forEach((s, i) => {
          gradientParts.push(`${s.color} ${s.start.toFixed(2)}deg ${s.end.toFixed(2)}deg`)
          // gap is implicit between s.end and next start due to accDeg increment
        })
        const gradient = gradientParts.join(', ')
        const humanize = (secs) => {
          const total = Math.max(0, Math.round(secs))
          const h = Math.floor(total / 3600)
          const m = Math.floor((total % 3600) / 60)
          if (h > 0) return `${h} hr${h!==1?'s':''}${m>0?`, ${m} min${m!==1?'s':''}`:''}`
          if (total < 60) return `${total} sec${total!==1?'s':''}`
          return `${m} min${m!==1?'s':''}`
        }
        const selectedLabel = reportSelection || null
        const selection = selectedLabel && segments.find(s => s.label === normalizeName(selectedLabel))
        const centerTitle = selection ? selection.label : 'TODAY'
        const centerText = selection ? formatTime(Math.round(selection.value)) : humanize(totalSum)
        return (
          <section className="pie">
            <h3>Time by session</h3>
            <div className="pie-chart-wrap" ref={pieWrapRef}>
              <div className="pie-donut" style={{ background: `conic-gradient(${gradient})` }}>
                <div className="pie-center" onClick={() => setReportSelection(null)}>
                  <div className="center-title">{centerTitle}</div>
                  <div className="center-value">{centerText}</div>
                </div>
              </div>
              
            </div>
            {/* Legend below the pie */}
            <div className="pie-legend">
              {entries.map(([label, value], i) => {
                const timeText = (() => { const total = Math.max(0, Math.round(value)); if (total < 60) { return `${total} secs` } const mins = Math.ceil(total / 60); return `${mins} mins` })()
                return (
                  <div key={`legend-${i}`} className="legend-row">
                    <span className="legend-color" style={{ background: segments[i]?.color || '#888' }} />
                    <span className="legend-text">{label}</span>
                    <span className="legend-time">{timeText}</span>
                  </div>
                )
              })}
            </div>
          </section>
        )
      })()}

      {activeTab !== 'report' ? (
        <section className="sessions">
          <h3>Completed sessions</h3>
          {sessions.length === 0 ? (
            <p className="muted">No sessions yet. Finish a timer to log one.</p>
          ) : (
            <ul className="session-list">
              {sessions.map((s) => (
                <li key={s.id} className="session-item">

                  <div className="session-row">
                    <div className="session-main">
                      <div className="session-meta">
                        <span className="when">{new Date(s.endedAt).toLocaleString()}</span>
                        <span className="duration">{formatTime(s.durationSeconds)}</span>
                      </div>
                      {Array.isArray(s.tags) && s.tags.length > 0 && (
                        <div className="tags">
                          {s.tags.map((t, i) => (
                            <span key={i} className="tag">{t}</span>
                          ))}
                        </div>
                      )}
                      {s.note ? <div className="note">{s.note}</div> : <div className="note muted">(no note)</div>}
                    </div>
                    <div className="session-actions">
                      <button onClick={() => startEditSession(s)}>Edit</button>
                      <button className="danger" onClick={() => deleteSession(s.id)}>Delete</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {isNoteOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h2>Session complete</h2>
            <p>What did you accomplish?</p>
            <textarea
              rows={4}
              placeholder="Write a short note..."
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
            <div style={{ marginTop: 8 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Tags (comma-separated)</label>
              <input
                type="text"
                placeholder="e.g. project, practice"
                value={noteTagsText}
                onChange={(e) => setNoteTagsText(e.target.value)}
                style={{ width: '100%', padding: 10, borderRadius: 10, background: '#0a0f1c', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text)' }}
              />
            </div>
            <div className="modal-actions">
              <button onClick={() => saveSession(true)}>Save</button>
              <button onClick={() => saveSession(false)} className="secondary">Skip</button>
            </div>
          </div>
        </div>
      )}

      {isEditOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h2>Edit session note</h2>
            <p>Update the note for this session.</p>
            <textarea
              rows={4}
              placeholder="Write a short note..."
              value={editNoteText}
              onChange={(e) => setEditNoteText(e.target.value)}
            />
            <div style={{ marginTop: 8 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Tags (comma-separated)</label>
              <input
                type="text"
                placeholder="e.g. project, practice"
                value={editTagsText}
                onChange={(e) => setEditTagsText(e.target.value)}
                style={{ width: '100%', padding: 10, borderRadius: 10, background: '#0a0f1c', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text)' }}
              />
            </div>
            <div className="modal-actions">
              <button onClick={saveEditSession}>Save</button>
              <button onClick={() => { setIsEditOpen(false); setEditingSession(null); setEditNoteText(''); setEditTagsText('') }} className="secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}


    </div>
  )
} 