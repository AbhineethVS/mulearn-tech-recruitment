import {
  closestCorners,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  Check,
  ChevronRight,
  CirclePlus,
  Clock3,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  MoreHorizontal,
  Pencil,
  Search,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { toast, Toaster } from 'sonner'
import './boardline.css'
import {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  DEMO_USER_ID,
  priorityMeta,
  seedProjects,
  seedTasks,
  statusMeta,
  type Priority,
  type Project,
  type Status,
  type Task,
} from './lib/data'
import { isSupabaseConfigured, supabase } from './lib/supabase'

const StatusChart = lazy(() => import('./components/StatusChart'))

type UserState = { id: string; email: string; isDemo: boolean }
type View = 'dashboard' | 'projects' | 'board'
type ProjectDraft = Pick<Project, 'title' | 'description' | 'deadline' | 'color'>
type TaskDraft = Pick<Task, 'title' | 'description' | 'assignee_name' | 'priority' | 'deadline' | 'status'>

const storage = {
  read<T>(key: string, fallback: T): T {
    try {
      return JSON.parse(localStorage.getItem(key) ?? '') as T
    } catch {
      return fallback
    }
  },
  write(key: string, value: unknown) {
    localStorage.setItem(key, JSON.stringify(value))
  },
}

const makeId = () => crypto.randomUUID()
const today = new Date().toISOString().slice(0, 10)

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`logo-lockup ${compact ? 'logo-compact' : ''}`}>
      <span className="logo-mark" aria-hidden="true"><span /><span /><span /></span>
      {!compact && <span>Boardline</span>}
    </div>
  )
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: UserState) => void }) {
  const [email, setEmail] = useState(DEMO_EMAIL)
  const [password, setPassword] = useState(DEMO_PASSWORD)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    if (email === DEMO_EMAIL && password === DEMO_PASSWORD) {
      const demo = { id: DEMO_USER_ID, email, isDemo: true }
      storage.write('boardline.session', demo)
      onAuthenticated(demo)
      setBusy(false)
      return
    }
    if (!supabase) {
      toast.error('Cloud auth is not configured. Use the pre-filled demo account.')
      setBusy(false)
      return
    }
    const result = mode === 'login'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password })
    if (result.error) toast.error(result.error.message)
    else if (result.data.user && result.data.session) {
      onAuthenticated({ id: result.data.user.id, email, isDemo: false })
    } else toast.success('Check your inbox to confirm your account.')
    setBusy(false)
  }

  return (
    <main className="auth-page">
      <section className="auth-story" aria-label="Boardline product preview">
        <Logo />
        <div className="auth-copy">
          <p className="kicker">Projects move when the next step is clear.</p>
          <h1>Keep the work visible. Keep the team moving.</h1>
          <p>A focused project board for student teams that need clarity, not more process.</p>
        </div>
        <div className="preview-board" aria-hidden="true">
          {(['To do', 'In progress', 'Review'] as const).map((label, column) => (
            <div className="preview-column" key={label}>
              <small>{label}</small>
              {[0, 1].slice(0, column === 2 ? 1 : 2).map((item) => (
                <div className="preview-card" key={item}>
                  <span style={{ width: `${72 - item * 18}%` }} />
                  <span style={{ width: `${45 + column * 8}%` }} />
                </div>
              ))}
            </div>
          ))}
        </div>
        <p className="auth-quote">Built for MuLearn teams who would rather ship the project than manage the tool.</p>
      </section>
      <section className="auth-panel">
        <div className="auth-mobile-logo"><Logo /></div>
        <form className="auth-form" onSubmit={submit}>
          <div>
            <p className="section-note">Welcome to Boardline</p>
            <h2>{mode === 'login' ? 'Continue your work' : 'Create your workspace'}</h2>
            <p className="muted">{mode === 'login' ? 'The demo account is ready to use—just continue.' : 'Use email and password. No social account required.'}</p>
          </div>
          <div className="demo-note">
            <Sparkles size={18} aria-hidden="true" />
            <div><strong>Demo access is pre-filled</strong><span>Changes stay in this browser, so it is safe to explore.</span></div>
          </div>
          <label>Email
            <input type="email" value={email} autoComplete="email" onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label>Password
            <input type="password" value={password} minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} onChange={(event) => setPassword(event.target.value)} required />
          </label>
          <button className="button button-primary button-wide" type="submit" disabled={busy}>
            {busy ? 'Working…' : mode === 'login' ? 'Open demo workspace' : 'Create account'}
            {!busy && <ChevronRight size={18} aria-hidden="true" />}
          </button>
          <button className="text-button" type="button" onClick={() => setMode((value) => value === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? 'Need an account? Register' : 'Already registered? Log in'}
          </button>
          {!isSupabaseConfigured && <p className="config-hint">Cloud login activates when Supabase environment keys are set.</p>}
        </form>
      </section>
    </main>
  )
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><h2 id="modal-title">{title}</h2><button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={19} /></button></header>
        {children}
      </section>
    </div>
  )
}

function ProjectForm({ project, onSave, onClose }: { project?: Project; onSave: (draft: ProjectDraft) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<ProjectDraft>({
    title: project?.title ?? '', description: project?.description ?? '', deadline: project?.deadline ?? '', color: project?.color ?? '#ff715b',
  })
  return (
    <form className="form-stack" onSubmit={(event) => { event.preventDefault(); onSave(draft) }}>
      <label>Project title<input autoFocus value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} required /></label>
      <label>Description<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={3} required /></label>
      <div className="form-row">
        <label>Deadline<input type="date" value={draft.deadline} onChange={(event) => setDraft({ ...draft, deadline: event.target.value })} required /></label>
        <label>Project color<input className="color-input" type="color" value={draft.color} onChange={(event) => setDraft({ ...draft, color: event.target.value })} /></label>
      </div>
      <div className="modal-actions"><button className="button button-quiet" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit">Save project</button></div>
    </form>
  )
}

function TaskForm({ task, onSave, onClose }: { task?: Task; onSave: (draft: TaskDraft) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<TaskDraft>({
    title: task?.title ?? '', description: task?.description ?? '', assignee_name: task?.assignee_name ?? '', priority: task?.priority ?? 'medium', deadline: task?.deadline ?? '', status: task?.status ?? 'todo',
  })
  return (
    <form className="form-stack" onSubmit={(event) => { event.preventDefault(); onSave(draft) }}>
      <label>Task title<input autoFocus value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} required /></label>
      <label>Description<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={3} required /></label>
      <div className="form-row">
        <label>Assignee<input value={draft.assignee_name} onChange={(event) => setDraft({ ...draft, assignee_name: event.target.value })} placeholder="Team member" required /></label>
        <label>Deadline<input type="date" value={draft.deadline} onChange={(event) => setDraft({ ...draft, deadline: event.target.value })} required /></label>
      </div>
      <div className="form-row">
        <label>Priority<select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as Priority })}>{Object.entries(priorityMeta).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label>
        <label>Status<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as Status })}>{Object.entries(statusMeta).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label>
      </div>
      <div className="modal-actions"><button className="button button-quiet" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit">Save task</button></div>
    </form>
  )
}

function DraggableTask({ task, onEdit, onDelete }: { task: Task; onEdit: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id, data: { status: task.status } })
  return (
    <article ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform) }} className={`task-card ${isDragging ? 'task-dragging' : ''}`} {...listeners} {...attributes}>
      <div className="task-card-top">
        <span className={`priority priority-${task.priority}`}>{priorityMeta[task.priority].label}</span>
        <div className="task-actions">
          <button type="button" className="mini-button" aria-label={`Edit ${task.title}`} onPointerDown={(event) => event.stopPropagation()} onClick={onEdit}><Pencil size={14} /></button>
          <button type="button" className="mini-button danger" aria-label={`Delete ${task.title}`} onPointerDown={(event) => event.stopPropagation()} onClick={onDelete}><Trash2 size={14} /></button>
        </div>
      </div>
      <h3>{task.title}</h3><p>{task.description}</p>
      <footer>
        <span className="avatar" aria-label={`Assigned to ${task.assignee_name}`}>{task.assignee_name.slice(0, 2).toUpperCase()}</span>
        <span className={task.deadline < today && task.status !== 'completed' ? 'overdue' : ''}><CalendarDays size={14} aria-hidden="true" />{new Date(`${task.deadline}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
      </footer>
    </article>
  )
}

function BoardColumn({ status, tasks, onEdit, onDelete }: { status: Status; tasks: Task[]; onEdit: (task: Task) => void; onDelete: (task: Task) => void }) {
  const { isOver, setNodeRef } = useDroppable({ id: status })
  return (
    <section ref={setNodeRef} className={`board-column ${isOver ? 'column-over' : ''}`} style={{ '--column-tint': statusMeta[status].tint } as CSSProperties}>
      <header><span>{statusMeta[status].label}</span><b>{tasks.length}</b></header>
      <div className="task-list">
        {tasks.map((task) => <DraggableTask key={task.id} task={task} onEdit={() => onEdit(task)} onDelete={() => onDelete(task)} />)}
        {tasks.length === 0 && <p className="empty-column">Drop a task here</p>}
      </div>
    </section>
  )
}

export default function Boardline() {
  const [user, setUser] = useState<UserState | null>(() => storage.read('boardline.session', null))
  const [projects, setProjects] = useState<Project[]>(() => storage.read('boardline.projects', seedProjects))
  const [tasks, setTasks] = useState<Task[]>(() => storage.read('boardline.tasks', seedTasks))
  const [view, setView] = useState<View>('dashboard')
  const [activeProjectId, setActiveProjectId] = useState(seedProjects[0].id)
  const [projectModal, setProjectModal] = useState<Project | 'new' | null>(null)
  const [taskModal, setTaskModal] = useState<Task | 'new' | null>(null)
  const [search, setSearch] = useState('')
  const [priority, setPriority] = useState<Priority | 'all'>('all')
  const [menuOpen, setMenuOpen] = useState(false)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor))

  useEffect(() => {
    if (!user || user.isDemo || !supabase) return
    Promise.all([supabase.from('projects').select('*').order('created_at'), supabase.from('tasks').select('*').order('position')]).then(([projectResult, taskResult]) => {
      if (projectResult.error || taskResult.error) toast.error('Could not load the workspace.')
      else { setProjects((projectResult.data ?? []) as Project[]); setTasks((taskResult.data ?? []) as Task[]) }
    })
  }, [user])
  useEffect(() => {
    if (!user?.isDemo) return
    storage.write('boardline.projects', projects); storage.write('boardline.tasks', tasks)
  }, [projects, tasks, user])

  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0]
  const projectTasks = useMemo(() => tasks.filter((task) => task.project_id === activeProject?.id).filter((task) => task.title.toLowerCase().includes(search.toLowerCase())).filter((task) => priority === 'all' || task.priority === priority).sort((a, b) => a.position - b.position), [activeProject?.id, priority, search, tasks])
  const metrics = useMemo(() => {
    const completed = tasks.filter((task) => task.status === 'completed').length
    return { total: tasks.length, completed, pending: tasks.length - completed, overdue: tasks.filter((task) => task.deadline < today && task.status !== 'completed').length }
  }, [tasks])
  const chartData = (Object.keys(statusMeta) as Status[]).map((status) => ({
    name: statusMeta[status].label, tasks: tasks.filter((task) => task.status === status).length,
    fill: { todo: '#ff8c73', in_progress: '#f4b942', review: '#9270e7', completed: '#5d9f76' }[status],
  }))

  async function upsertProject(draft: ProjectDraft) {
    const existing = projectModal !== 'new' ? projectModal : null
    const record: Project = existing ? { ...existing, ...draft } : { ...draft, id: makeId(), owner_id: user!.id, created_at: new Date().toISOString() }
    setProjects((current) => existing ? current.map((item) => item.id === record.id ? record : item) : [...current, record])
    if (!user!.isDemo && supabase) { const { error } = await supabase.from('projects').upsert(record); if (error) toast.error(error.message) }
    setProjectModal(null); toast.success(existing ? 'Project updated' : 'Project created')
  }
  async function deleteProject(project: Project) {
    if (!window.confirm(`Delete “${project.title}” and all of its tasks?`)) return
    setProjects((current) => current.filter((item) => item.id !== project.id)); setTasks((current) => current.filter((task) => task.project_id !== project.id))
    if (!user!.isDemo && supabase) { const { error } = await supabase.from('projects').delete().eq('id', project.id); if (error) toast.error(error.message) }
    toast.success('Project deleted')
  }
  async function upsertTask(draft: TaskDraft) {
    const existing = taskModal !== 'new' ? taskModal : null
    const record: Task = existing ? { ...existing, ...draft } : { ...draft, id: makeId(), project_id: activeProject.id, owner_id: user!.id, position: projectTasks.filter((task) => task.status === draft.status).length, created_at: new Date().toISOString() }
    setTasks((current) => existing ? current.map((item) => item.id === record.id ? record : item) : [...current, record])
    if (!user!.isDemo && supabase) { const { error } = await supabase.from('tasks').upsert(record); if (error) toast.error(error.message) }
    setTaskModal(null); toast.success(existing ? 'Task updated' : 'Task created')
  }
  async function deleteTask(task: Task) {
    if (!window.confirm(`Delete “${task.title}”?`)) return
    setTasks((current) => current.filter((item) => item.id !== task.id))
    if (!user!.isDemo && supabase) { const { error } = await supabase.from('tasks').delete().eq('id', task.id); if (error) toast.error(error.message) }
    toast.success('Task deleted')
  }
  async function moveTask(event: DragEndEvent) {
    const task = tasks.find((item) => item.id === event.active.id)
    const nextStatus = event.over?.id as Status | undefined
    if (!task || !nextStatus || !statusMeta[nextStatus] || task.status === nextStatus) return
    const position = tasks.filter((item) => item.project_id === task.project_id && item.status === nextStatus).length
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: nextStatus, position } : item))
    if (!user!.isDemo && supabase) { const { error } = await supabase.from('tasks').update({ status: nextStatus, position }).eq('id', task.id); if (error) toast.error(error.message) }
    toast.success(`Moved to ${statusMeta[nextStatus].label}`)
  }
  async function logout() {
    storage.write('boardline.session', null); if (!user?.isDemo) await supabase?.auth.signOut(); setUser(null); setView('dashboard')
  }

  if (!user) return <><AuthScreen onAuthenticated={setUser} /><Toaster position="top-right" richColors /></>
  const nav = [{ id: 'dashboard' as const, label: 'Overview', icon: LayoutDashboard }, { id: 'projects' as const, label: 'Projects', icon: FolderKanban }]

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-head"><Logo /><button className="icon-button mobile-only" onClick={() => setMenuOpen(false)} aria-label="Close menu"><X size={20} /></button></div>
        <nav aria-label="Main navigation">
          <p>Workspace</p>
          {nav.map((item) => <button key={item.id} className={view === item.id ? 'nav-active' : ''} onClick={() => { setView(item.id); setMenuOpen(false) }}><item.icon size={19} />{item.label}</button>)}
          <p>Recent projects</p>
          {projects.slice(0, 4).map((project) => <button key={project.id} className={view === 'board' && project.id === activeProjectId ? 'nav-active' : ''} onClick={() => { setActiveProjectId(project.id); setView('board'); setMenuOpen(false) }}><span className="project-dot" style={{ background: project.color }} /><span className="truncate">{project.title}</span></button>)}
        </nav>
        <div className="sidebar-user"><span className="avatar avatar-large">AB</span><span><strong>{user.isDemo ? 'Demo member' : user.email.split('@')[0]}</strong><small>{user.isDemo ? 'Local workspace' : 'Member'}</small></span><button className="icon-button" type="button" onClick={logout} aria-label="Log out"><LogOut size={18} /></button></div>
      </aside>
      {menuOpen && <button className="menu-scrim" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}
      <main className="workspace">
        <header className="topbar">
          <button className="icon-button mobile-only" onClick={() => setMenuOpen(true)} aria-label="Open menu"><Menu size={21} /></button>
          <div className="top-search"><Search size={18} aria-hidden="true" /><input aria-label="Search tasks" placeholder="Search tasks" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
          <div className="topbar-meta"><span className="online-dot" />Demo ready</div>
        </header>
        <div className="page">
          {view === 'dashboard' && <>
            <header className="page-heading dashboard-heading">
              <div><p className="section-note">Monday, 09 November</p><h1>Good afternoon, Abhi.</h1><p className="muted">Here is where the work stands across your projects.</p></div>
              <button className="button button-primary" onClick={() => setProjectModal('new')}><CirclePlus size={18} />New project</button>
            </header>
            <section className="metric-grid" aria-label="Task summary">
              {[
                { label: 'All tasks', value: metrics.total, icon: BarChart3, tone: 'coral' }, { label: 'Completed', value: metrics.completed, icon: Check, tone: 'green' },
                { label: 'In motion', value: metrics.pending, icon: Clock3, tone: 'amber' }, { label: 'Overdue', value: metrics.overdue, icon: CalendarDays, tone: 'lilac' },
              ].map((metric) => <article className={`metric metric-${metric.tone}`} key={metric.label}><span className="metric-icon"><metric.icon size={19} /></span><div><b>{metric.value}</b><span>{metric.label}</span></div></article>)}
            </section>
            <section className="dashboard-grid">
              <article className="chart-panel">
                <div className="panel-heading"><div><h2>Work by status</h2><p>All active project tasks</p></div><span className="soft-chip">Live count</span></div>
                <Suspense fallback={<div className="chart-wrap chart-loading">Loading chart…</div>}>
                  <StatusChart data={chartData} />
                </Suspense>
                <p className="sr-only">{chartData.map((item) => `${item.name}: ${item.tasks}`).join(', ')}</p>
              </article>
              <article className="recent-panel">
                <div className="panel-heading"><div><h2>Projects in focus</h2><p>Nearest deadlines first</p></div></div>
                <div className="focus-list">{[...projects].sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 3).map((project) => {
                  const count = tasks.filter((task) => task.project_id === project.id).length
                  const done = tasks.filter((task) => task.project_id === project.id && task.status === 'completed').length
                  const percent = count ? Math.round((done / count) * 100) : 0
                  return <button className="focus-item" key={project.id} onClick={() => { setActiveProjectId(project.id); setView('board') }}><span className="project-swatch" style={{ background: project.color }} /><span className="focus-copy"><strong>{project.title}</strong><small>{percent}% complete</small><span className="progress-track"><span style={{ width: `${percent}%`, background: project.color }} /></span></span><ChevronRight size={18} /></button>
                })}</div>
              </article>
            </section>
          </>}
          {view === 'projects' && <>
            <header className="page-heading"><div><p className="section-note">Project directory</p><h1>All projects</h1><p className="muted">Open a board or shape the next piece of work.</p></div><button className="button button-primary" onClick={() => setProjectModal('new')}><CirclePlus size={18} />New project</button></header>
            <section className="project-grid">{projects.map((project) => {
              const count = tasks.filter((task) => task.project_id === project.id).length
              return <article className="project-card" key={project.id}><span className="project-card-stripe" style={{ background: project.color }} /><div className="project-card-head"><span className="project-icon" style={{ color: project.color }}><FolderKanban size={21} /></span><div><button className="mini-button" onClick={() => setProjectModal(project)} aria-label={`Edit ${project.title}`}><Pencil size={15} /></button><button className="mini-button danger" onClick={() => deleteProject(project)} aria-label={`Delete ${project.title}`}><Trash2 size={15} /></button></div></div><h2>{project.title}</h2><p>{project.description}</p><div className="project-card-meta"><span><CalendarDays size={15} />{new Date(`${project.deadline}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span><span><MoreHorizontal size={15} />{count} tasks</span></div><button className="open-project" onClick={() => { setActiveProjectId(project.id); setView('board') }}>Open board <ChevronRight size={17} /></button></article>
            })}</section>
          </>}
          {view === 'board' && activeProject && <>
            <header className="board-heading">
              <button className="back-button" onClick={() => setView('projects')}><ArrowLeft size={18} />Projects</button>
              <div className="board-title-row"><div><p className="section-note">Project board</p><h1>{activeProject.title}</h1><p className="muted">{activeProject.description}</p></div><button className="button button-primary" onClick={() => setTaskModal('new')}><CirclePlus size={18} />New task</button></div>
              <div className="board-tools"><div className="member-stack" aria-label="Project members">{['AB', 'NI', 'AK'].map((name) => <span className="avatar" key={name}>{name}</span>)}<span className="member-count"><Users size={14} />3</span></div><label className="filter-label">Priority<select value={priority} onChange={(event) => setPriority(event.target.value as Priority | 'all')}><option value="all">All priorities</option>{Object.entries(priorityMeta).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label></div>
            </header>
            <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={moveTask}><section className="kanban" aria-label={`${activeProject.title} Kanban board`}>{(Object.keys(statusMeta) as Status[]).map((status) => <BoardColumn key={status} status={status} tasks={projectTasks.filter((task) => task.status === status)} onEdit={setTaskModal} onDelete={deleteTask} />)}</section></DndContext>
          </>}
        </div>
      </main>
      {projectModal && <Modal title={projectModal === 'new' ? 'Create a project' : 'Edit project'} onClose={() => setProjectModal(null)}><ProjectForm project={projectModal === 'new' ? undefined : projectModal} onSave={upsertProject} onClose={() => setProjectModal(null)} /></Modal>}
      {taskModal && <Modal title={taskModal === 'new' ? 'Create a task' : 'Edit task'} onClose={() => setTaskModal(null)}><TaskForm task={taskModal === 'new' ? undefined : taskModal} onSave={upsertTask} onClose={() => setTaskModal(null)} /></Modal>}
      <Toaster position="top-right" richColors />
    </div>
  )
}
