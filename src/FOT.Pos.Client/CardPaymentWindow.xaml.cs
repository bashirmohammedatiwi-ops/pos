using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Animation;
using FOT.Pos.Client.Services;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Client;

public partial class CardPaymentWindow : Window
{
    private readonly decimal _amount;
    private CancellationTokenSource? _cts;
    private bool _isClosing;
    private readonly List<Storyboard> _looping = [];

    public CardPaymentDto? Payment { get; private set; }

    public CardPaymentWindow(decimal amount)
    {
        InitializeComponent();
        PosOverlay.Prepare(this);
        _amount = amount;
    }

    private async void Window_OnLoaded(object sender, RoutedEventArgs e)
    {
        PlayEnterAnimation();
        await Task.Delay(380);
        await ChargeAsync();
    }

    private void PlayEnterAnimation()
    {
        PlayOnTarget("CardPayBackdropIn", Backdrop);
        PlayOnTarget("CardPayWindowIn", MainCard);
        StartLoop("CardPayOrbFloat", Orb1);
        StartLoop("CardPayOrbFloat2", Orb2);
        StartLoop("CardPayOrbFloat3", Orb3);
        StartLoop("CardPayOrbFloat2", Orb4);
        StartLoop("CardPayHaloSpin", HaloOuter);
        StartLoop("CardPayHaloSpinReverse", HaloInner);
        StartLoop("CardPayCardFloat", CreditCardVisual);
        StartLoop("CardPayChipGlow", CardChip);
        StartLoop("CardPayShadowPulse", FloorShadow);
        StartSparks();
    }

    private void StartSparks()
    {
        var sparks = new[] { Spark1, Spark2, Spark3, Spark4, Spark5, Spark6, Spark7, Spark8 };
        var delays = new[] { 0, 0.55, 1.1, 1.75, 2.3, 0.35, 2.85, 1.45 };
        for (var i = 0; i < sparks.Length; i++)
        {
            if (TryFindResource("CardPaySparkRise") is not Storyboard src) continue;
            var sb = src.Clone();
            sb.BeginTime = TimeSpan.FromSeconds(delays[i]);
            Storyboard.SetTarget(sb, sparks[i]);
            sb.Begin();
            _looping.Add(sb);
        }
    }

    private void PlayOnTarget(string key, FrameworkElement target)
    {
        if (TryFindResource(key) is not Storyboard sb) return;
        sb = sb.Clone();
        Storyboard.SetTarget(sb, target);
        sb.Begin();
    }

    private void StartLoop(string key, FrameworkElement target)
    {
        if (TryFindResource(key) is not Storyboard sb) return;
        sb = sb.Clone();
        Storyboard.SetTarget(sb, target);
        sb.Begin();
        _looping.Add(sb);
    }

    private void StopLoops()
    {
        foreach (var sb in _looping) sb.Stop();
        _looping.Clear();
    }

    private async void Retry_Click(object sender, RoutedEventArgs e)
    {
        SuccessPanel.Visibility = Visibility.Collapsed;
        HideError();
        _isClosing = false;
        await ChargeAsync();
    }

    private void Close_Click(object sender, RoutedEventArgs e)
    {
        if (_isClosing) return;
        _cts?.Cancel();
        DialogResult = Payment is not null;
        Close();
    }

    private async Task ChargeAsync()
    {
        var terminal = AppServices.CardTerminal;
        _cts = new CancellationTokenSource();
        HideError();

        try
        {
            if (!await terminal.EnsureConnectedAsync(_cts.Token))
            {
                Fail($"جهاز الدفع غير متصل ({terminal.ServiceAddress ?? "بدون عنوان"})");
                return;
            }

            var result = await terminal.ChargeAsync(_amount, _cts.Token);

            if (!result.Ok || result.Payment is null)
            {
                Fail(result.CancelledByDevice
                    ? string.IsNullOrWhiteSpace(result.Message) ? "تم إلغاء الدفع من الجهاز" : result.Message
                    : result.Message);
                return;
            }

            Payment = result.Payment;
            await PlaySuccessAndCloseAsync();
        }
        catch (OperationCanceledException)
        {
            if (!_isClosing)
                await CloseWithAnimationAsync(false);
        }
        catch (Exception ex)
        {
            Fail(ex.Message);
        }
    }

    private async Task PlaySuccessAndCloseAsync()
    {
        _isClosing = true;
        HideError();
        SuccessPanel.Visibility = Visibility.Visible;
        PlayOnTarget("CardPaySuccessIn", SuccessPanel);
        PlayOnTarget("CardPaySuccessBurst", SuccessBurst);
        PlayOnTarget("CardPaySuccessBurst", SuccessBurst2);
        await Task.Delay(1200);
        await CloseWithAnimationAsync(true);
    }

    private async Task CloseWithAnimationAsync(bool success)
    {
        StopLoops();
        if (TryFindResource("CardPayWindowOut") is Storyboard exit)
        {
            exit = exit.Clone();
            Storyboard.SetTarget(exit, MainCard);
            var tcs = new TaskCompletionSource();
            exit.Completed += (_, _) => tcs.TrySetResult();
            exit.Begin();
            var fade = new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(280));
            Backdrop.BeginAnimation(OpacityProperty, fade);
            await tcs.Task;
        }

        DialogResult = success;
        Close();
    }

    private void HideError()
    {
        ErrorHost.Visibility = Visibility.Collapsed;
        ErrorText.Text = "";
    }

    private void Fail(string message)
    {
        ErrorText.Text = message;
        ErrorHost.Visibility = Visibility.Visible;
        PlayOnTarget("CardPayErrorIn", ErrorHost);

        if (TryFindResource("CardPayFailShake") is Storyboard shake)
        {
            shake = shake.Clone();
            Storyboard.SetTarget(shake, MainCard);
            shake.Begin();
        }
    }
}
