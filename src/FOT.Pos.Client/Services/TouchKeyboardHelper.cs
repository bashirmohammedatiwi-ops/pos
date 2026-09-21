using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;

namespace FOT.Pos.Client.Services;

/// <summary>Suppresses the Windows touch keyboard (TabTip) — for POS with physical keyboards.</summary>
public static class TouchKeyboardHelper
{
    private const uint WmClose = 0x0010;

    public static readonly DependencyProperty SuppressProperty =
        DependencyProperty.RegisterAttached(
            "Suppress",
            typeof(bool),
            typeof(TouchKeyboardHelper),
            new PropertyMetadata(false, OnSuppressChanged));

    public static bool GetSuppress(DependencyObject obj) => (bool)obj.GetValue(SuppressProperty);
    public static void SetSuppress(DependencyObject obj, bool value) => obj.SetValue(SuppressProperty, value);

    public static void ApplyToWindow(Window window)
    {
        window.AddHandler(UIElement.GotFocusEvent, new RoutedEventHandler(OnAnyGotFocus), true);
        window.AddHandler(UIElement.PreviewGotKeyboardFocusEvent, new KeyboardFocusChangedEventHandler(OnPreviewKeyboardFocus), true);
    }

    private static void OnSuppressChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is not UIElement el || e.NewValue is not true) return;
        el.GotFocus += (_, _) => Hide();
        InputMethod.SetIsInputMethodEnabled(el, false);
    }

    private static void OnAnyGotFocus(object sender, RoutedEventArgs e)
    {
        if (e.OriginalSource is TextBox or PasswordBox or ComboBox)
            Hide();
    }

    private static void OnPreviewKeyboardFocus(object sender, KeyboardFocusChangedEventArgs e)
    {
        if (e.NewFocus is TextBox or PasswordBox or ComboBox)
        {
            Hide();
            if (e.NewFocus is DependencyObject d)
                InputMethod.SetIsInputMethodEnabled(d, false);
        }
    }

    public static void Hide()
    {
        CloseWindow("IPTip_Main_Window", null);
        CloseWindow("IPTip_Main_Window", "Microsoft Text Input Application");
        CloseWindow("TouchKeyboardWindow", null);
    }

    private static void CloseWindow(string className, string? windowName)
    {
        var hwnd = FindWindow(className, windowName);
        if (hwnd != IntPtr.Zero)
            PostMessage(hwnd, WmClose, IntPtr.Zero, IntPtr.Zero);
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr FindWindow(string? lpClassName, string? lpWindowName);

    [DllImport("user32.dll")]
    private static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
}
