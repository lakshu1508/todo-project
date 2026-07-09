import React, { useState, useEffect } from 'react';

// Targets cloud service APIs when deployed, falls back to local machine loop automatically
const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api";

export default function TodoList() {
  const [userEmail, setUserEmail] = useState(null);
  const [userName, setUserName] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  
  const [savedAccounts, setSavedAccounts] = useState([]);
  const [isNewUser, setIsNewUser] = useState(false);
  const [authError, setAuthError] = useState('');

  // Data lists
  const [myInboundTodos, setMyInboundTodos] = useState([]);
  const [globalOutboundTodos, setGlobalOutboundTodos] = useState([]);
  
  // Assignment Processing States
  const [taskText, setTaskText] = useState('');
  const [reminderTime, setReminderTime] = useState('');
  const [taskTargetAssignee, setTaskTargetAssignee] = useState('');

  // 🛠️ ANTI-DUPLICATION LOCK STATE
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchSavedProfiles();
    fetchGlobalOutboundTodos();
    
    const activeEmail = localStorage.getItem('active_sandbox_user');
    const activeName = localStorage.getItem('active_sandbox_username');
    if (activeEmail && activeName) {
      setUserEmail(activeEmail);
      setUserName(activeName);
      fetchInboundTodos(activeEmail);
    }
  }, []);

  useEffect(() => {
    const checkReminders = setInterval(() => {
      const nowString = new Date().toLocaleString([], { 
        year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' 
      });

      myInboundTodos.forEach(todo => {
        if (todo.reminder && !todo.completed && !todo.reminder_triggered) {
          const todoReminderString = new Date(todo.reminder).toLocaleString([], {
            year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric'
          });

          if (nowString === todoReminderString) {
            handleMarkTriggeredInBackend(todo.id);
            playNotificationSound();
            alert(`⏰ REMINDER FOR ${userName || userEmail}:\n\nTask: "${todo.text}"`);
          }
        }
      });
    }, 5000);

    return () => clearInterval(checkReminders);
  }, [myInboundTodos, userEmail, userName]);

  const fetchSavedProfiles = async () => {
    try {
      const res = await fetch(`${API_BASE}/profiles`);
      if (res.ok) {
        const data = await res.json();
        setSavedAccounts(data);
      }
    } catch (err) {
      console.error("Backend link broken or sleeping", err);
    }
  };

  const fetchGlobalOutboundTodos = async () => {
    try {
      const res = await fetch(`${API_BASE}/profiles`);
      if (res.ok) {
        const profiles = await res.json();
        let aggregatedOutbound = [];
        
        for (let profile of profiles) {
          const resOutbound = await fetch(`${API_BASE}/todos/tracked/${profile.email}`);
          if (resOutbound.ok) {
            const dataOutbound = await resOutbound.json();
            aggregatedOutbound = [...aggregatedOutbound, ...dataOutbound];
          }
        }
        
        const uniqueOutbound = aggregatedOutbound.filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);
        setGlobalOutboundTodos(uniqueOutbound);
      }
    } catch (err) {
      console.error("Error gathering global tracker metrics:", err);
    }
  };

  const fetchInboundTodos = async (email) => {
    try {
      const resInbound = await fetch(`${API_BASE}/todos/my-work/${email}`);
      if (resInbound.ok) {
        const dataInbound = await resInbound.json();
        setMyInboundTodos(dataInbound);
      }
    } catch (err) {
      console.error("Error pulling inbound tasks:", err);
    }
  };

  const checkEmailStatus = (email) => {
    const formattedEmail = email.trim().toLowerCase();
    setIsNewUser(!savedAccounts.some(p => p.email === formattedEmail));
  };

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    const formattedEmail = emailInput.trim().toLowerCase();
    setAuthError('');
    setIsSubmitting(true);

    const endpoint = isNewUser ? "/register" : "/login";
    const bodyPayload = isNewUser 
      ? { email: formattedEmail, password: passwordInput, name: nameInput.trim() }
      : { email: formattedEmail, password: passwordInput };

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload)
      });

      const data = await res.json();

      if (!res.ok) {
        setAuthError(data.detail || "Authentication failed.");
        return;
      }

      setUserEmail(data.email);
      setUserName(data.name);
      localStorage.setItem('active_sandbox_user', data.email);
      localStorage.setItem('active_sandbox_username', data.name);
      
      await fetchInboundTodos(data.email);
      await fetchSavedProfiles();
      await fetchGlobalOutboundTodos();
    } catch (err) {
      setAuthError("Server is unreachable. Make sure backend is awake.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddTask = async (e) => {
    e.preventDefault();
    if (isSubmitting || !taskText.trim() || !taskTargetAssignee) return;

    setIsSubmitting(true);

    const payload = {
      text: taskText,
      timestamp: new Date().toLocaleString(),
      assigned_to: taskTargetAssignee,
      reminder: reminderTime ? reminderTime : null
    };

    try {
      const res = await fetch(`${API_BASE}/todos/${userEmail}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        setTaskText('');
        setReminderTime('');
        setTaskTargetAssignee('');
        // ✅ Instantly updates both your panel data configurations!
        await fetchInboundTodos(userEmail);
        await fetchGlobalOutboundTodos();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleTodo = async (id) => {
    try {
      const res = await fetch(`${API_BASE}/todos/${id}/toggle`, { method: 'PATCH' });
      if (res.ok) {
        if (userEmail) await fetchInboundTodos(userEmail);
        await fetchGlobalOutboundTodos();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleMarkTriggeredInBackend = async (id) => {
    try {
      const res = await fetch(`${API_BASE}/todos/${id}/triggered`, { method: 'PATCH' });
      if (res.ok) {
        if (userEmail) await fetchInboundTodos(userEmail);
        await fetchGlobalOutboundTodos();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const deleteTodo = async (id) => {
    try {
      const res = await fetch(`${API_BASE}/todos/${id}`, { method: 'DELETE' });
      if (res.ok) {
        if (userEmail) await fetchInboundTodos(userEmail);
        await fetchGlobalOutboundTodos();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSelectQuickAccount = (account) => {
    if (isSubmitting) return;
    setEmailInput(account.email);
    setIsNewUser(false);
    setAuthError('');
  };

  const handleLogout = () => {
    setUserEmail(null);
    setUserName('');
    setMyInboundTodos([]);
    setEmailInput('');
    setPasswordInput('');
    setNameInput('');
    setIsNewUser(false);
    localStorage.removeItem('active_sandbox_user');
    localStorage.removeItem('active_sandbox_username');
    fetchGlobalOutboundTodos();
  };

  const playNotificationSound = () => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(587.33, audioCtx.currentTime);
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.3);
    } catch (e) {
      console.log("Audio block bypass", e);
    }
  };

  const inboundActive = myInboundTodos.filter(t => !t.completed);
  const inboundDone = myInboundTodos.filter(t => t.completed);

  return (
    <div style={{ maxWidth: '1000px', margin: '40px auto', padding: '0 20px' }}>
      
      {/* AUTHENTICATION LAYER */}
      {!userEmail ? (
        <div style={styles.container}>
          <h2 style={styles.title}>🔐 Client Dashboard Access (Full-Stack)</h2>

          {savedAccounts.length > 0 && (
            <div style={styles.quickSelectContainer}>
              <span style={styles.sectionLabel}>🔄 Accounts in Cloud DB:</span>
              <div style={styles.badgeRow}>
                {savedAccounts.map((account) => (
                  <button 
                    key={account.email} 
                    onClick={() => handleSelectQuickAccount(account)}
                    disabled={isSubmitting}
                    style={{
                      ...styles.profileBadge,
                      opacity: isSubmitting ? 0.6 : 1,
                      borderColor: emailInput.toLowerCase() === account.email ? '#6366f1' : '#1f2937'
                    }}
                  >
                    <p style={styles.badgeName}>👤 {account.name}</p>
                    <span style={styles.badgeEmail}>{account.email}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <form onSubmit={handleLoginSubmit} style={styles.verticalForm}>
            <input 
              type="email" 
              placeholder="Client Email" 
              value={emailInput} 
              onChange={(e) => {
                setEmailInput(e.target.value);
                checkEmailStatus(e.target.value);
              }}
              disabled={isSubmitting}
              style={styles.input}
              required
            />

            {isNewUser && emailInput.includes('@') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <p style={styles.infoNote}>✨ New account layout detected! Enter your profile registration name:</p>
                <input 
                  type="text" 
                  placeholder="Your Full Name / Company Name" 
                  value={nameInput} 
                  onChange={(e) => setNameInput(e.target.value)}
                  disabled={isSubmitting}
                  style={styles.input}
                  required
                />
              </div>
            )}

            <input 
              type="password" 
              placeholder="Password" 
              value={passwordInput} 
              onChange={(e) => setPasswordInput(e.target.value)}
              disabled={isSubmitting}
              style={styles.input}
              required
            />

            {authError && <p style={styles.errorText}>⚠️ {authError}</p>}
            <button type="submit" style={{...styles.primaryBtn, opacity: isSubmitting ? 0.7 : 1}} disabled={isSubmitting}>
              {isSubmitting ? 'Processing Pipeline...' : isNewUser ? 'Register Account to DB' : 'Login Securely'}
            </button>
          </form>
        </div>
      ) : (
        <div style={{...styles.container, maxWidth: '100%'}}>
          <div style={styles.headerRow}>
            <div>
              <h3 style={{ margin: 0, color: '#6366f1' }}>💼 Connected: {userName}</h3>
              <span style={{ fontSize: '12px', color: '#9ca3af' }}>{userEmail}</span>
            </div>
            <button onClick={handleLogout} style={styles.logoutBtn} disabled={isSubmitting}>Logout</button>
          </div>

          <hr style={{ borderColor: '#1f2937', margin: '20px 0' }} />

          <h2 style={styles.title}>📝 Cloud Task Assignment Engine</h2>
          
          <form onSubmit={handleAddTask} style={styles.verticalForm}>
            <input 
              type="text" 
              placeholder="What instruction or requirement needs delegating?" 
              value={taskText} 
              onChange={(e) => setTaskText(e.target.value)} 
              disabled={isSubmitting}
              style={styles.input}
              required
            />
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <label style={{ fontSize: '12px', color: '#9ca3af', minWidth: '85px' }}>👤 Assign To:</label>
                <select
                  value={taskTargetAssignee}
                  onChange={(e) => setTaskTargetAssignee(e.target.value)}
                  disabled={isSubmitting}
                  style={{...styles.input, width: '100%', height: '40px'}}
                  required
                >
                  <option value="" style={{backgroundColor: '#0b0f19'}}>Select Teammate...</option>
                  {savedAccounts.map(account => (
                    <option key={account.email} value={account.email} style={{backgroundColor: '#0b0f19'}}>
                      {account.name} ({account.email}) {account.email === userEmail ? "[Myself]" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <label style={{ fontSize: '12px', color: '#9ca3af', minWidth: '85px' }}>⏰ Reminder:</label>
                <input 
                  type="datetime-local" 
                  value={reminderTime} 
                  onChange={(e) => setReminderTime(e.target.value)} 
                  disabled={isSubmitting}
                  style={styles.input} 
                />
              </div>
            </div>

            <button type="submit" style={{...styles.addBtn, opacity: isSubmitting ? 0.7 : 1}} disabled={isSubmitting}>
              {isSubmitting ? "Committing Entry..." : "Issue & Assign Task via Cloud"}
            </button>
          </form>
        </div>
      )}

      {/* LOWER PANELS GRID */}
      <div style={{ 
        marginTop: '30px',
        backgroundColor: '#111827',
        padding: '25px',
        borderRadius: '12px',
        border: '1px solid #1f2937'
      }}>
        
        {userEmail ? (
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#f59e0b', borderBottom: '1px solid #1f2937', paddingBottom: '8px', marginBottom: '15px', marginTop: 0 }}>
              📥 Assigned To Me ({inboundActive.length})
            </h3>
            
            <h4 style={{ ...styles.sectionLabel, color: '#d97706', fontSize: '11px' }}>⚡ In Progress</h4>
            <ul style={styles.list}>
              {inboundActive.map(todo => (
                <li key={todo.id} style={styles.listItem}>
                  <div style={styles.todoContent}>
                    <div style={styles.todoTextGroup}>
                      <input 
                        type="checkbox" 
                        checked={todo.completed} 
                        onChange={() => toggleTodo(todo.id)} 
                        style={styles.checkbox}
                      />
                      <span style={styles.todoText}>{todo.text}</span>
                    </div>
                    <div style={styles.metaContainer}>
                      <span style={styles.metaText}>👤 From: {todo.assigned_by}</span>
                      <span style={styles.metaText}>📅 Date: {todo.timestamp}</span>
                      {todo.reminder && (
                        <span style={{ ...styles.metaText, color: todo.reminder_triggered ? '#6b7280' : '#f59e0b' }}>
                          {todo.reminder_triggered ? '✅ Alert Sent:' : '🔔 Alert:'} {new Date(todo.reminder).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <button onClick={() => deleteTodo(todo.id)} style={styles.deleteBtn}>🗑️</button>
                </li>
              ))}
            </ul>
            {inboundActive.length === 0 && <p style={styles.emptyText}>No inbound items to execute.</p>}

            <h4 style={{ ...styles.sectionLabel, color: '#059669', fontSize: '11px', marginTop: '20px' }}>🎉 Completed Tasks</h4>
            <ul style={styles.list}>
              {inboundDone.map(todo => (
                <li key={todo.id} style={{ ...styles.listItem, opacity: 0.65, backgroundColor: '#090d16', borderColor: '#111827' }}>
                  <div style={styles.todoContent}>
                    <div style={styles.todoTextGroup}>
                      <input 
                        type="checkbox" 
                        checked={todo.completed} 
                        onChange={() => toggleTodo(todo.id)} 
                        style={styles.checkbox}
                      />
                      <span style={{ ...styles.todoText, textDecoration: 'line-through', color: '#9ca3af' }}>{todo.text}</span>
                    </div>
                    <div style={styles.metaContainer}>
                      <span style={styles.metaText}>👤 From: {todo.assigned_by}</span>
                    </div>
                  </div>
                  <button onClick={() => deleteTodo(todo.id)} style={styles.deleteBtn}>🗑️</button>
                </li>
              ))}
            </ul>
            {inboundDone.length === 0 && <p style={styles.emptyText}>Nothing in completed list.</p>}
          </div>
        ) : (
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#10b981', borderBottom: '1px solid #1f2937', paddingBottom: '8px', marginBottom: '15px', marginTop: 0 }}>
              📤 Assigned To Others (Live Status Tracker)
            </h3>
            
            <ul style={styles.list}>
              {globalOutboundTodos.map(todo => (
                <li key={todo.id} style={{
                  ...styles.listItem,
                  borderColor: todo.status === 'Done' ? '#065f46' : '#1f2937',
                  background: todo.status === 'Done' ? '#04070d' : '#0b0f19'
                }}>
                  <div style={styles.todoContent}>
                    <p style={{
                      ...styles.todoText, 
                      margin: 0, 
                      fontWeight: '500',
                      textDecoration: todo.status === 'Done' ? 'line-through' : 'none',
                      color: todo.status === 'Done' ? '#6b7280' : '#fff'
                    }}>
                      {todo.text}
                    </p>
                    <div style={styles.metaContainer}>
                      <span style={styles.metaText}>👤 Issued By: <span style={{color: '#9ca3af'}}>{todo.assigned_by}</span></span>
                      <span style={styles.metaText}>👤 Assigned To: <b style={{color: '#818cf8'}}>{todo.assigned_to}</b></span>
                      <span style={styles.metaText}>📅 Date: {todo.timestamp}</span>
                      <span style={{
                        fontSize: '11px', 
                        fontWeight: '700', 
                        marginTop: '4px',
                        color: todo.status === 'Done' ? '#10b981' : '#f59e0b'
                      }}>
                        📡 Current Status: {todo.status}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {globalOutboundTodos.length === 0 && <p style={styles.emptyText}>No outbound tasks issued inside the cloud pipeline yet.</p>}
          </div>
        )}

      </div>
    </div>
  );
}

const styles = {
  container: { backgroundColor: '#111827', padding: '30px', borderRadius: '12px', width: '100%', maxWidth: '500px', margin: '0 auto', border: '1px solid #1f2937', boxShadow: '0 4px 15px rgba(0,0,0,0.5)', fontFamily: 'system-ui, sans-serif', boxSizing: 'border-box' },
  title: { margin: '0 0 15px 0', fontSize: '20px', fontWeight: '700', color: '#fff', textAlign: 'center' },
  sectionLabel: { fontSize: '13px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', margin: '15px 0 10px 0', display: 'block' },
  quickSelectContainer: { backgroundColor: '#0b0f19', padding: '12px', borderRadius: '8px', border: '1px solid #1f2937', marginBottom: '20px' },
  badgeRow: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' },
  profileBadge: { background: '#111827', border: '1px solid #1f2937', borderRadius: '6px', padding: '6px 12px', textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', minWidth: '100px' },
  badgeName: { color: '#fff', fontSize: '13px', margin: 0, fontWeight: '600' },
  badgeEmail: { color: '#6b7280', fontSize: '10px' },
  infoNote: { color: '#10b981', fontSize: '12px', margin: '0 0 -4px 0' },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  verticalForm: { display: 'flex', flexDirection: 'column', gap: '12px' },
  input: { flex: 1, padding: '10px 14px', backgroundColor: '#0b0f19', border: '1px solid #374151', borderRadius: '6px', color: '#fff', fontSize: '14px', outline: 'none' },
  primaryBtn: { padding: '12px', backgroundColor: '#6366f1', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '600', cursor: 'pointer', marginTop: '5px', transition: 'opacity 0.2s' },
  addBtn: { padding: '12px', backgroundColor: '#10b981', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '600', cursor: 'pointer', transition: 'opacity 0.2s' },
  logoutBtn: { padding: '6px 12px', backgroundColor: '#ef4444', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '12px', cursor: 'pointer' },
  list: { listStyleType: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' },
  listItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', backgroundColor: '#0b0f19', padding: '14px 16px', borderRadius: '8px', border: '1px solid #1f2937' },
  todoContent: { display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 },
  todoTextGroup: { display: 'flex', alignItems: 'center', gap: '12px' },
  checkbox: { cursor: 'pointer', width: '16px', height: '16px', marginTop: '2px' },
  todoText: { fontSize: '15px', color: '#fff' },
  metaContainer: { display: 'flex', flexDirection: 'column', gap: '2px', paddingLeft: '28px' },
  metaText: { fontSize: '11px', color: '#9ca3af' },
  deleteBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', padding: '0 0 0 10px', marginTop: '2px' },
  emptyText: { color: '#4b5563', fontStyle: 'italic', fontSize: '13px', marginTop: '5px', paddingLeft: '10px' },
  errorText: { color: '#ef4444', fontSize: '12px', margin: '0' }
};
