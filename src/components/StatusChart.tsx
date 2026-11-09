import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

type ChartItem = {
  name: string
  tasks: number
  fill: string
}

export default function StatusChart({ data }: { data: ChartItem[] }) {
  return (
    <div className="chart-wrap" aria-label="Bar chart showing tasks by status">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 18, right: 8, left: -24, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#e8e7e4" />
          <XAxis
            dataKey="name"
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#696862', fontSize: 12 }}
          />
          <YAxis
            allowDecimals={false}
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#8b8982', fontSize: 12 }}
          />
          <Tooltip cursor={{ fill: '#f7f6f3' }} />
          <Bar dataKey="tasks" radius={[8, 8, 2, 2]} maxBarSize={48}>
            {data.map((item) => (
              <Cell key={item.name} fill={item.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
