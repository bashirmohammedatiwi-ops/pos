using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;

namespace FOT.Pos.Client.Services;

public static class PosToast
{
    private static Storyboard? _timerOut;

    public static void Show(Border host, TextBlock label, string message, bool success = true)
    {
        label.Text = message;
        host.Background = success
            ? new SolidColorBrush(Color.FromRgb(6, 78, 59))
            : new SolidColorBrush(Color.FromRgb(127, 29, 29));
        label.Foreground = success
            ? new SolidColorBrush(Color.FromRgb(209, 250, 229))
            : new SolidColorBrush(Color.FromRgb(254, 226, 226));
        host.Opacity = 0;
        host.Visibility = Visibility.Visible;

        if (host.TryFindResource("ToastIn") is Storyboard fadeIn)
        {
            fadeIn = fadeIn.Clone();
            fadeIn.Begin(host);
        }
        else
        {
            host.Opacity = 1;
        }

        _timerOut?.Stop();
        _timerOut = host.TryFindResource("ToastOut") as Storyboard;
        if (_timerOut is not null)
        {
            _timerOut = _timerOut.Clone();
            _timerOut.Completed += (_, _) => host.Visibility = Visibility.Collapsed;
            _timerOut.Begin(host);
        }
    }
}
