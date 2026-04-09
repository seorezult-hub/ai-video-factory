import { cn } from "@/lib/utils";

type Step = { id: number; label: string };

type Props = {
  step: Step;
  currentStep: number;
  onClick: () => void;
};

export function WizardStep({ step, currentStep, onClick }: Props) {
  const isDone = step.id < currentStep;
  const isActive = step.id === currentStep;

  return (
    <button
      onClick={onClick}
      disabled={!isDone}
      className={cn(
        "flex-1 h-2 rounded-full transition-all",
        isActive && "bg-purple-500",
        isDone && "bg-purple-700 cursor-pointer hover:bg-purple-600",
        !isActive && !isDone && "bg-white/10"
      )}
      title={step.label}
    />
  );
}
