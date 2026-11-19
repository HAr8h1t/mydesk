import test from 'node:test'
import assert from 'node:assert/strict'
import { getScheduleOverview } from './scheduling.js'

const startDate = '2026-03-02'
const now = new Date(2026, 2, 2, 8, 0)

test('reports overlapping activities and available workday windows', () => {
  const { days } = getScheduleOverview(
    [{ id: 'task', title: 'Write report', startDate, startTime: '10:00', estimatedMinutes: 120 }],
    [{ id: 'event', title: 'Team meeting', date: startDate, startTime: '09:00', endTime: '11:00' }],
    { startDate, days: 1, now },
  )

  assert.equal(days[0].conflicts.length, 1)
  assert.deepEqual(days[0].freeSlots, [{ start: 12 * 60, end: 17 * 60 }])
})

test('marks a day with six scheduled hours as overloaded', () => {
  const events = Array.from({ length: 6 }, (_, index) => ({
    id: `event-${index}`,
    title: `Event ${index}`,
    date: startDate,
    startTime: `${String(9 + index).padStart(2, '0')}:00`,
    endTime: `${String(10 + index).padStart(2, '0')}:00`,
  }))
  const { days } = getScheduleOverview([], events, { startDate, days: 1, now })

  assert.equal(days[0].workloadMinutes, 360)
  assert.equal(days[0].overloaded, true)
})

test('suggests duration-aware slots in priority and deadline order', () => {
  const { recommendations } = getScheduleOverview(
    [
      { id: 'low', title: 'Quick cleanup', priority: 'Low', estimatedMinutes: 30, dueDate: '2026-03-03' },
      { id: 'urgent', title: 'Submit proposal', priority: 'Urgent', estimatedMinutes: 120, dueDate: '2026-03-03' },
    ],
    [{ id: 'event', title: 'Standup', date: startDate, startTime: '09:00', endTime: '10:00' }],
    { startDate, days: 1, now },
  )

  assert.deepEqual(recommendations.map(item => item.task.id), ['urgent', 'low'])
  assert.deepEqual(recommendations.map(({ start, end }) => [start, end]), [
    [10 * 60, 12 * 60],
    [12 * 60, 12 * 60 + 30],
  ])
})

test('recommends moving the lower-priority task out of an overlap', () => {
  const { recommendations } = getScheduleOverview(
    [
      { id: 'scheduled', title: 'Draft notes', status: 'pending', startDate, startTime: '09:30', estimatedMinutes: 60, priority: 'Low' },
      { id: 'done', title: 'Completed', status: 'completed', startDate, startTime: '10:00', estimatedMinutes: 30, priority: 'Urgent' },
    ],
    [{ id: 'event', title: 'Client call', date: startDate, startTime: '09:00', endTime: '10:00' }],
    { startDate, days: 1, now },
  )

  assert.equal(recommendations[0].task.id, 'scheduled')
  assert.equal(recommendations[0].start, 10 * 60)
  assert.match(recommendations[0].reason, /Client call/)
})

test('counts repeating events and excludes tasks that cannot meet their deadline', () => {
  const { days, recommendations } = getScheduleOverview(
    [{ id: 'late', title: 'Past deadline', dueDate: '2026-03-01', priority: 'Urgent' }],
    [{ id: 'weekly', title: 'Weekly review', date: startDate, repeat: 'weekly', startTime: '09:00', endTime: '12:00' }],
    { startDate, days: 8, now },
  )

  assert.equal(days[0].workloadMinutes, 180)
  assert.equal(days[7].workloadMinutes, 180)
  assert.equal(days[0].overloaded, false)
  assert.deepEqual(recommendations, [])
})
