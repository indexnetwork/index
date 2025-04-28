'use client';

interface StakeDistribution {
  relevancy: number;
  reputation: number;
  intentHistory: number;
  urgency: number;
}

interface StakeDistributionChartProps {
  distribution: StakeDistribution;
}

export default function StakeDistributionChart({ distribution }: StakeDistributionChartProps) {
  const colors = {
    relevancy: 'bg-[#7B68EE] dark:bg-[#9B88FF]',
    reputation: 'bg-[#2ECC71] dark:bg-[#4EEC91]',
    intentHistory: 'bg-[#FFA500] dark:bg-[#FFB520]',
    urgency: 'bg-[#FF4444] dark:bg-[#FF6464]'
  };

  const labels = {
    relevancy: 'Relevancy',
    reputation: 'Reputation',
    intentHistory: 'Intent History',
    urgency: 'Urgency'
  };

  const total = Object.values(distribution).reduce((sum, value) => sum + value, 0);
  const percentages = Object.entries(distribution).map(([key, value]) => ({
    category: key,
    percentage: (value / total) * 100
  }));

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">Stake Distribution by Category</h4>
    

      {/* Legend */}
      <div className="flex flex-wrap gap-6 mt-2">
        {Object.entries(distribution).map(([category, value]) => (
          <div key={category} className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-sm ${colors[category as keyof typeof colors]}`} />
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {labels[category as keyof typeof labels]} (${value})
            </span>
          </div>
        ))}
      </div>
    </div>
  );
} 