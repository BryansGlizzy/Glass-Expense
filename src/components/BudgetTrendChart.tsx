import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

interface Expense {
  id: string;
  amount: number;
  entry_type: 'expense' | 'income';
  created_at: string;
}

interface BudgetTrendChartProps {
  expenses: Expense[];
}

export default function BudgetTrendChart({ expenses }: BudgetTrendChartProps) {
  const data = useMemo(() => {
    if (!expenses.length) return [];

    let runningBalance = 0;
    
    // Sort chronologically (oldest to newest) to show flow over time
    // Replace space with T to ensure cross-browser Date parsing works with SQLite timestamps
    const sorted = [...expenses].sort((a, b) => 
      new Date(a.created_at.replace(' ', 'T')).getTime() - new Date(b.created_at.replace(' ', 'T')).getTime()
    );

    // We can insert a starting point of 0 balance to ground the chart
    const chartData = [{
      date: 'Start',
      balance: 0,
    }];

    sorted.forEach((exp) => {
      runningBalance += (exp.entry_type === 'income' ? exp.amount : -exp.amount);
      chartData.push({
        date: new Date(exp.created_at.replace(' ', 'T')).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        balance: runningBalance,
      });
    });

    return chartData;
  }, [expenses]);

  const gradientOffset = () => {
    if (data.length === 0) return 0;
    const dataMax = Math.max(...data.map((i) => i.balance));
    const dataMin = Math.min(...data.map((i) => i.balance));

    if (dataMax <= 0) return 0;
    if (dataMin >= 0) return 1;

    return dataMax / (dataMax - dataMin);
  };

  const off = gradientOffset();

  if (data.length <= 1) {
    return (
      <div className="bg-[#1c172d]/40 border border-white/5 rounded-3xl p-6 h-64 flex items-center justify-center mt-6">
        <p className="text-gray-500 text-sm">Not enough data for chart</p>
      </div>
    );
  }

  // Custom Tooltip with glassmorphism to match the app theme
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const balance = payload[0].value;
      const isPositive = balance >= 0;
      
      return (
        <div className="bg-[#1c172d]/90 backdrop-blur-md border border-white/10 p-3 rounded-xl shadow-xl">
          <p className="text-gray-400 text-xs mb-1">{label}</p>
          <p className={`font-bold text-lg ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
            {isPositive ? '+' : '-'}${Math.abs(balance).toFixed(2)}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-[#1c172d]/60 border border-white/5 rounded-3xl p-6 mt-6 shadow-xl">
      <h3 className="text-gray-400 font-medium mb-6">Historical Trend</h3>
      <div style={{ width: '100%', height: 200, minHeight: 200 }}>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart
            data={data}
            margin={{ top: 10, right: 0, left: -20, bottom: 0 }}
          >
            <defs>
              <linearGradient id="splitColor" x1="0" y1="0" x2="0" y2="1">
                <stop offset={off} stopColor="#34d399" stopOpacity={0.4} />
                <stop offset={off} stopColor="#fb7185" stopOpacity={0.4} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
            <XAxis 
              dataKey="date" 
              stroke="#ffffff40" 
              fontSize={10} 
              tickMargin={10}
              tickLine={false}
              axisLine={false}
              minTickGap={20}
            />
            <YAxis 
              stroke="#ffffff40" 
              fontSize={10} 
              tickFormatter={(value) => `$${value}`}
              tickLine={false}
              axisLine={false}
              width={60}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#ffffff20', strokeWidth: 1 }} />
            <ReferenceLine y={0} stroke="#ffffff40" strokeWidth={1} />
            <Area
              type="monotone"
              dataKey="balance"
              stroke="#a78bfa"
              strokeWidth={2}
              fill="url(#splitColor)"
              activeDot={{ r: 5, fill: '#7c3bed', stroke: '#1c172d', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
