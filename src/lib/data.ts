export type Status = 'todo' | 'in_progress' | 'review' | 'completed'
export type Priority = 'low' | 'medium' | 'high' | 'critical'

export type Project = {
  id: string
  owner_id: string
  title: string
  description: string
  deadline: string
  color: string
  created_at: string
}

export type Task = {
  id: string
  project_id: string
  owner_id: string
  title: string
  description: string
  assignee_name: string
  priority: Priority
  deadline: string
  status: Status
  position: number
  created_at: string
}

export const DEMO_EMAIL = 'demo@boardline.app'
export const DEMO_PASSWORD = 'boardline2026'
export const DEMO_USER_ID = '00000000-0000-4000-8000-000000000001'

const now = new Date()
const date = (offset: number) => {
  const value = new Date(now)
  value.setDate(value.getDate() + offset)
  return value.toISOString().slice(0, 10)
}

export const seedProjects: Project[] = [
  {
    id: 'project-orbit',
    owner_id: DEMO_USER_ID,
    title: 'Orbit website',
    description: 'Launch the new community website and member directory.',
    deadline: date(12),
    color: '#ff715b',
    created_at: now.toISOString(),
  },
  {
    id: 'project-hacknight',
    owner_id: DEMO_USER_ID,
    title: 'Hacknight 06',
    description: 'Plan the campus build night, mentors, and judging.',
    deadline: date(24),
    color: '#8b5cf6',
    created_at: now.toISOString(),
  },
  {
    id: 'project-mobile',
    owner_id: DEMO_USER_ID,
    title: 'Member mobile app',
    description: 'Research and prototype the first member app release.',
    deadline: date(41),
    color: '#f4b942',
    created_at: now.toISOString(),
  },
]

export const seedTasks: Task[] = [
  {
    id: 'task-1',
    project_id: 'project-orbit',
    owner_id: DEMO_USER_ID,
    title: 'Map the member journey',
    description: 'Document the paths for new and returning members.',
    assignee_name: 'Akhil',
    priority: 'high',
    deadline: date(-2),
    status: 'todo',
    position: 0,
    created_at: now.toISOString(),
  },
  {
    id: 'task-2',
    project_id: 'project-orbit',
    owner_id: DEMO_USER_ID,
    title: 'Write launch copy',
    description: 'Draft clear copy for the homepage and join flow.',
    assignee_name: 'Nila',
    priority: 'medium',
    deadline: date(4),
    status: 'todo',
    position: 1,
    created_at: now.toISOString(),
  },
  {
    id: 'task-3',
    project_id: 'project-orbit',
    owner_id: DEMO_USER_ID,
    title: 'Build responsive shell',
    description: 'Implement navigation and page-level responsive behavior.',
    assignee_name: 'Abhi',
    priority: 'critical',
    deadline: date(2),
    status: 'in_progress',
    position: 0,
    created_at: now.toISOString(),
  },
  {
    id: 'task-4',
    project_id: 'project-orbit',
    owner_id: DEMO_USER_ID,
    title: 'Review directory filters',
    description: 'Test search behavior against real member profiles.',
    assignee_name: 'Diya',
    priority: 'high',
    deadline: date(1),
    status: 'review',
    position: 0,
    created_at: now.toISOString(),
  },
  {
    id: 'task-5',
    project_id: 'project-orbit',
    owner_id: DEMO_USER_ID,
    title: 'Set up project repository',
    description: 'Create the project and agree on contribution rules.',
    assignee_name: 'Abhi',
    priority: 'low',
    deadline: date(-4),
    status: 'completed',
    position: 0,
    created_at: now.toISOString(),
  },
  {
    id: 'task-6',
    project_id: 'project-hacknight',
    owner_id: DEMO_USER_ID,
    title: 'Confirm mentor roster',
    description: 'Reach out to technical mentors and confirm time slots.',
    assignee_name: 'Nila',
    priority: 'high',
    deadline: date(7),
    status: 'in_progress',
    position: 0,
    created_at: now.toISOString(),
  },
  {
    id: 'task-7',
    project_id: 'project-hacknight',
    owner_id: DEMO_USER_ID,
    title: 'Publish challenge brief',
    description: 'Finalize the judging criteria and starter resources.',
    assignee_name: 'Akhil',
    priority: 'medium',
    deadline: date(10),
    status: 'todo',
    position: 0,
    created_at: now.toISOString(),
  },
  {
    id: 'task-8',
    project_id: 'project-mobile',
    owner_id: DEMO_USER_ID,
    title: 'Interview five members',
    description: 'Collect recurring needs and current workarounds.',
    assignee_name: 'Diya',
    priority: 'medium',
    deadline: date(15),
    status: 'todo',
    position: 0,
    created_at: now.toISOString(),
  },
]

export const statusMeta: Record<Status, { label: string; tint: string }> = {
  todo: { label: 'To do', tint: '#f7f7f8' },
  in_progress: { label: 'In progress', tint: '#fff7e4' },
  review: { label: 'Review', tint: '#f2edff' },
  completed: { label: 'Completed', tint: '#eaf7ef' },
}

export const priorityMeta: Record<Priority, { label: string; color: string }> = {
  low: { label: 'Low', color: '#5d7c68' },
  medium: { label: 'Medium', color: '#a4671d' },
  high: { label: 'High', color: '#c44e3b' },
  critical: { label: 'Critical', color: '#a92f46' },
}
