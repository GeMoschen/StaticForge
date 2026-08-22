package com.acme.staticforge.asset.media;

/** Normalized focal point for smart cropping (spec §11.3), in {0..1} relative units. */
public record FocalPoint(double x, double y) {

    public static final FocalPoint CENTER = new FocalPoint(0.5, 0.5);

    public static FocalPoint of(Double x, Double y) {
        if (x == null && y == null) {
            return CENTER;
        }
        double fx = x == null ? 0.5 : clamp(x);
        double fy = y == null ? 0.5 : clamp(y);
        return new FocalPoint(fx, fy);
    }

    private static double clamp(double v) {
        return Math.max(0.0, Math.min(1.0, v));
    }
}
