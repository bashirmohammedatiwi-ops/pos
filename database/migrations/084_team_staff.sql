-- تطبيق الفريق: جدول موظفين موحّد (بائعون، كاشيرية، مشرفون، آخرون) + صلاحيات المدراء.
-- كل حساب ويب بائع موجود يُنقل تلقائياً بنفس الرمز، فلا ينقطع أحد.

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_staff')
BEGIN
    CREATE TABLE ext_staff (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ext_staff PRIMARY KEY,
        code            NVARCHAR(20)  NOT NULL,
        name            NVARCHAR(200) NOT NULL,
        kind            NVARCHAR(20)  NOT NULL CONSTRAINT DF_ext_staff_kind DEFAULT (N'seller'),
        job_title       NVARCHAR(120) NULL,
        phone           NVARCHAR(40)  NULL,
        photo_url       NVARCHAR(400) NULL,
        salesman_id     BIGINT NULL,
        cashier_id      BIGINT NULL,
        section_id      BIGINT NULL,
        pin_hash        NVARCHAR(200) NULL,
        pin_display     NVARCHAR(20)  NULL,
        is_active       BIT NOT NULL CONSTRAINT DF_ext_staff_active DEFAULT (1),
        hire_date       DATE NULL,
        notes           NVARCHAR(1000) NULL,
        device_id       NVARCHAR(120) NULL,
        device_label    NVARCHAR(200) NULL,
        device_bound_at DATETIME2 NULL,
        created_at      DATETIME2 NOT NULL CONSTRAINT DF_ext_staff_created DEFAULT (SYSUTCDATETIME()),
        updated_at      DATETIME2 NOT NULL CONSTRAINT DF_ext_staff_updated DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT CK_ext_staff_kind CHECK (kind IN (N'seller', N'cashier', N'supervisor', N'other'))
    );
    CREATE UNIQUE INDEX UX_ext_staff_code ON ext_staff(code);
    CREATE UNIQUE INDEX UX_ext_staff_salesman ON ext_staff(salesman_id) WHERE salesman_id IS NOT NULL;
    CREATE UNIQUE INDEX UX_ext_staff_cashier ON ext_staff(cashier_id) WHERE cashier_id IS NOT NULL;
END
GO

-- ترحيل حسابات ويب البائعين الحالية: الكود = رقم البائع، ونفس الرمز ونفس حالة التفعيل
INSERT INTO ext_staff (code, name, kind, salesman_id, pin_hash, pin_display, is_active, created_at)
SELECT CAST(a.salesman_id AS NVARCHAR(20)),
       COALESCE(NULLIF(LTRIM(RTRIM(sm.name)), N''), N'بائع #' + CAST(a.salesman_id AS NVARCHAR(20))),
       N'seller', a.salesman_id, a.pin_hash, a.pin_display, a.is_active, a.created_at
FROM ext_seller_accounts a
LEFT JOIN salesmen sm ON sm.id = a.salesman_id
WHERE NOT EXISTS (SELECT 1 FROM ext_staff s WHERE s.salesman_id = a.salesman_id)
  AND NOT EXISTS (SELECT 1 FROM ext_staff s WHERE s.code = CAST(a.salesman_id AS NVARCHAR(20)));
GO

-- صلاحيات المدراء في التطبيق: الأقسام التي يديرها كل مدير (section_id NULL = كل الأقسام)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_team_manager_scopes')
CREATE TABLE ext_team_manager_scopes (
    user_id     BIGINT NOT NULL,
    section_id  BIGINT NOT NULL CONSTRAINT DF_ext_team_scope_section DEFAULT (0),
    CONSTRAINT PK_ext_team_manager_scopes PRIMARY KEY (user_id, section_id)
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_team_manager_perms')
CREATE TABLE ext_team_manager_perms (
    user_id             BIGINT NOT NULL CONSTRAINT PK_ext_team_manager_perms PRIMARY KEY,
    approve_leave       BIT NOT NULL CONSTRAINT DF_tmp_leave DEFAULT (1),
    view_attendance     BIT NOT NULL CONSTRAINT DF_tmp_att DEFAULT (1),
    edit_attendance     BIT NOT NULL CONSTRAINT DF_tmp_att_edit DEFAULT (0),
    send_announcements  BIT NOT NULL CONSTRAINT DF_tmp_ann DEFAULT (1),
    manage_groups       BIT NOT NULL CONSTRAINT DF_tmp_groups DEFAULT (0),
    view_sales          BIT NOT NULL CONSTRAINT DF_tmp_sales DEFAULT (1),
    updated_at          DATETIME2 NOT NULL CONSTRAINT DF_tmp_updated DEFAULT (SYSUTCDATETIME())
);
GO
