type TagVisibilityControlProps = {
  visible: boolean;
  disabled?: boolean;
  label: string;
};

export function TagVisibilityControl({
  visible,
  disabled = false,
  label,
}: TagVisibilityControlProps) {
  return (
    <button
      className="tagVisibilityControl"
      type="submit"
      role="switch"
      aria-checked={visible}
      aria-label={label}
      title={label}
      disabled={disabled}
    >
      <span className="tagVisibilitySlider" aria-hidden="true"><span /></span>
    </button>
  );
}
