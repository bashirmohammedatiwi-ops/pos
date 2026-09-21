using FOT.Pos.Infrastructure.Repositories;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace FOT.Pos.Infrastructure.Services;

/// <summary>
/// Runs commission posting and audit logging after checkout commits — never blocks the sale response.
/// </summary>
public sealed class ReceiptSideEffectsDispatcher(IServiceScopeFactory scopes, ILogger<ReceiptSideEffectsDispatcher> logger)
{
    public void ScheduleSaleCommitted(long receiptId, long number, long cashierId, long? posId, long salesmanId = 0)
    {
        _ = RunAsync(async sp =>
        {
            var post = sp.GetRequiredService<SalePostProcessor>();
            var log = sp.GetRequiredService<PosLogRepository>();
            await post.ProcessAsync(receiptId, salesmanId, CancellationToken.None);
            await log.LogAsync("receipt_create", $"إضافة إيصال #{number}", cashierId, posId,
                receiptId, number.ToString(), null, CancellationToken.None);
        }, receiptId);
    }

    public void ScheduleHoldCompleted(long holdId, long number, long salesmanId)
    {
        _ = RunAsync(async sp =>
        {
            var post = sp.GetRequiredService<SalePostProcessor>();
            var log = sp.GetRequiredService<PosLogRepository>();
            await post.ProcessAsync(holdId, salesmanId, CancellationToken.None);
            await log.LogAsync("hold_complete", $"إتمام معلّقة #{number}", null, null,
                holdId, number.ToString(), null, CancellationToken.None);
        }, holdId);
    }

    private Task RunAsync(Func<IServiceProvider, Task> work, long receiptId)
    {
        return Task.Run(async () =>
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                await work(scope.ServiceProvider);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Receipt side effects failed for receipt {ReceiptId}", receiptId);
            }
        });
    }
}
