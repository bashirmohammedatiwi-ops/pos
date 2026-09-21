namespace FOT.Pos.Shared;

public static class ProductPricing
{
    /// <summary>
    /// FOT POS V2: التخفيض من جدول offers/offer_details فقط.
    /// لا نستخدم SellPr5 من Edari — كان يخلط أسعار العروض القديمة.
    /// خصم المنتج المخزّن (ext_discount_percent) يُطبَّق بجانب العرض ويغلُب الأعمق منهما.
    /// </summary>
    public static (decimal Price, decimal OriginalPrice, int DiscountPercent, string? OfferName) Compute(
        decimal originalPrice,
        decimal storedFinalPrice,
        decimal? discountValue,
        int discountType,
        string? offerName,
        int storedDiscountPercent = 0)
    {
        _ = storedFinalPrice;
        var original = Math.Round(originalPrice);
        var hasActiveOffer = discountType == 2 ? discountValue is >= 0 : discountValue is > 0;
        var final = original;
        var offerWins = false;

        if (hasActiveOffer)
        {
            // 0 = نسبة %، 1 = مبلغ يُطرح، 2 = سعر بيع نهائي يُكتب يدوياً
            if (discountType == 2)
            {
                final = Math.Max(0, Math.Round(discountValue!.Value));
                offerWins = true;
            }
            else
            {
                final = discountType == 0
                    ? Math.Round(original * (1 - discountValue!.Value / 100))
                    : Math.Max(0, Math.Round(original - discountValue!.Value));
                if (final >= original) final = original;
                offerWins = final < original;
            }
        }

        if (storedDiscountPercent is > 0 and <= 100 && original > 0)
        {
            var storedFinal = Math.Round(original * (1 - storedDiscountPercent / 100m));
            if (storedFinal < final)
            {
                final = storedFinal;
                offerWins = false;
            }
        }

        var hasDiscount = original > 0 && final < original;
        var discountPercent = hasDiscount ? (int)Math.Round((1 - final / original) * 100) : 0;
        var published = discountType == 2 ? final : (hasDiscount ? final : original);
        return (published, original, discountPercent, offerWins ? offerName : null);
    }
}
