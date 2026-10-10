import type { WidgetItem } from '../types/Widget';

import type { ClaudeQuotaSummary } from './mochiapi';
import { formatResetCountdown } from './mochiapi';

function usd(value: number): string {
    if (value > 0 && value < 0.001)
        return '<$0.001';
    return `$${Number(value.toFixed(3))}`;
}

function allowance(remaining: number, used: number, total: number, unlimited: boolean, percent: boolean): string {
    if (unlimited)
        return '∞';
    if (percent)
        return total > 0 ? `${Math.round(used / total * 100)}%` : '?';
    return `${usd(remaining)}/${usd(total)}`;
}

export function formatClaudeQuota(summary: ClaudeQuotaSummary | null | undefined, item: WidgetItem): string {
    if (!summary)
        return '数据待升级';
    if (summary.status === 'none')
        return '未订阅';
    if (summary.status !== 'active' || !summary.plans.length)
        return '数据不可用';
    const percent = item.metadata?.quotaDisplay === 'percent';
    const now = Math.floor(Date.now() / 1000);
    return summary.plans.map((plan) => {
        if (plan.expiresAt > 0 && plan.expiresAt <= now)
            return '已到期';
        const pieces = [
            `${percent ? '日已用' : '日余'} ${allowance(plan.dailyRemainingUsd, plan.dailyUsedUsd, plan.dailyTotalUsd, plan.dailyUnlimited, percent)}`,
            `${percent ? '总已用' : '总余'} ${allowance(plan.remainingUsd, plan.usedUsd, plan.totalUsd, plan.unlimited, percent)}`
        ];
        if (!plan.dailyUnlimited && plan.dailyResetAt > 0)
            pieces.push(`日重置 ${formatResetCountdown(plan.dailyResetAt)}`);
        if (plan.resetAt > 0)
            pieces.push(`周期重置 ${formatResetCountdown(plan.resetAt)}`);
        if (plan.expiresAt > 0)
            pieces.push(`到期 ${formatResetCountdown(plan.expiresAt)}`);
        const result = pieces.join(' · ');
        return summary.plans.length > 1 ? `#${plan.id} ${result}` : result;
    }).join(' / ');
}
