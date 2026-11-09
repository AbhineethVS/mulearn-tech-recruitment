import { describe, expect, it } from 'vitest'
import { seedProjects, seedTasks, statusMeta } from './data'

describe('Boardline demo data', () => {
  it('uses the four statuses required by the brief', () => {
    expect(Object.keys(statusMeta)).toEqual(['todo', 'in_progress', 'review', 'completed'])
  })

  it('keeps every seeded task attached to a seeded project', () => {
    const projectIds = new Set(seedProjects.map((project) => project.id))
    expect(seedTasks.every((task) => projectIds.has(task.project_id))).toBe(true)
  })

  it('provides a populated board for an evaluator', () => {
    expect(seedProjects.length).toBeGreaterThanOrEqual(3)
    expect(seedTasks.length).toBeGreaterThanOrEqual(8)
  })
})
