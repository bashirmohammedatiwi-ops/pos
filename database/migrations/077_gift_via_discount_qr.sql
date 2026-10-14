-- Gift mode: unlock only after scanning unlimited-discount QR; lines added by barcode scan only.

IF COL_LENGTH('cashiers_permissions', 'gift_via_discount_qr') IS NULL

    ALTER TABLE cashiers_permissions

        ADD gift_via_discount_qr BIT NOT NULL CONSTRAINT DF_cp_gift_via_discount_qr DEFAULT 0;


