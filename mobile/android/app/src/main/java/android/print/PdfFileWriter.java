package android.print;

import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;

import java.io.File;

/**
 * يكتب مستند الطباعة إلى ملف PDF مباشرة دون نافذة الطباعة.
 * في هذه الحزمة لأن مُنشئَي ردَّي الاتصال غير ظاهرين خارجها. إن منعهما النظام يرمي LinkageError
 * فتعود الإضافة إلى نافذة الطباعة العادية.
 */
public final class PdfFileWriter {

    public interface Result {
        void done();
        void failed(String why);
    }

    private PdfFileWriter() {}

    public static void write(PrintDocumentAdapter adapter, PrintAttributes attributes, File out, Result result) {
        adapter.onStart();
        adapter.onLayout(null, attributes, new CancellationSignal(), new PrintDocumentAdapter.LayoutResultCallback() {
            @Override
            public void onLayoutFinished(PrintDocumentInfo info, boolean changed) {
                final ParcelFileDescriptor fd;
                try {
                    fd = ParcelFileDescriptor.open(out, ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_TRUNCATE | ParcelFileDescriptor.MODE_READ_WRITE);
                } catch (Exception e) {
                    adapter.onFinish();
                    result.failed(String.valueOf(e.getMessage()));
                    return;
                }
                adapter.onWrite(new PageRange[] { PageRange.ALL_PAGES }, fd, new CancellationSignal(), new PrintDocumentAdapter.WriteResultCallback() {
                    @Override
                    public void onWriteFinished(PageRange[] pages) {
                        close();
                        result.done();
                    }

                    @Override
                    public void onWriteFailed(CharSequence error) {
                        close();
                        result.failed(String.valueOf(error));
                    }

                    @Override
                    public void onWriteCancelled() {
                        close();
                        result.failed("cancelled");
                    }

                    private void close() {
                        adapter.onFinish();
                        try {
                            fd.close();
                        } catch (Exception ignored) {
                            /* الملف كُتب */
                        }
                    }
                });
            }

            @Override
            public void onLayoutFailed(CharSequence error) {
                adapter.onFinish();
                result.failed(String.valueOf(error));
            }

            @Override
            public void onLayoutCancelled() {
                adapter.onFinish();
                result.failed("cancelled");
            }
        }, null);
    }
}
