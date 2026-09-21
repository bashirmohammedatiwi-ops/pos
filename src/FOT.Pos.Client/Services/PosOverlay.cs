using System.Windows;
using System.Windows.Input;
using System.Windows.Media;

namespace FOT.Pos.Client.Services;

public static class PosOverlay
{
    public static bool? Show(Window dialog, Window owner)
    {
        Prepare(dialog);
        dialog.Owner = owner;
        SizeToOwner(dialog, owner);
        dialog.SourceInitialized += (_, _) => SizeToOwner(dialog, owner);
        return dialog.ShowDialog();
    }

    public static void Prepare(Window dialog)
    {
        dialog.WindowStyle = WindowStyle.None;
        dialog.AllowsTransparency = true;
        dialog.Background = Brushes.Transparent;
        dialog.ShowInTaskbar = false;
        dialog.ResizeMode = ResizeMode.NoResize;
        dialog.WindowStartupLocation = WindowStartupLocation.Manual;
        dialog.FlowDirection = FlowDirection.RightToLeft;
        dialog.UseLayoutRounding = true;
        dialog.SnapsToDevicePixels = true;
        dialog.PreviewKeyDown -= OnEscape;
        dialog.PreviewKeyDown += OnEscape;
    }

    public static void CloseQuietly(Window dialog)
    {
        try
        {
            if (dialog.IsVisible)
                dialog.DialogResult = false;
        }
        catch
        {
            dialog.Close();
        }
    }

    private static void OnEscape(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Escape || sender is not Window dialog) return;
        e.Handled = true;
        CloseQuietly(dialog);
    }

    private static void SizeToOwner(Window dialog, Window owner)
    {
        var origin = owner.PointToScreen(new Point(0, 0));
        var source = PresentationSource.FromVisual(owner);
        if (source?.CompositionTarget is not null)
            origin = source.CompositionTarget.TransformFromDevice.Transform(origin);

        var width = owner.ActualWidth > 1 ? owner.ActualWidth : SystemParameters.PrimaryScreenWidth;
        var height = owner.ActualHeight > 1 ? owner.ActualHeight : SystemParameters.PrimaryScreenHeight;

        dialog.WindowState = WindowState.Normal;
        dialog.Left = origin.X;
        dialog.Top = origin.Y;
        dialog.Width = width;
        dialog.Height = height;
    }
}
