import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function PermissionBar({
  reason,
  toolName,
  args,
  grantRoot,
  onAnswer,
}: {
  reason: string;
  toolName: string;
  args: string;
  grantRoot?: string;
  onAnswer: (answer: "allow" | "deny" | "allow_session") => void;
}) {
  return (
    <Alert>
      <AlertTitle>{grantRoot ? "Grant session root" : "Allow tool"}</AlertTitle>
      <AlertDescription>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            {grantRoot ? <p>path {grantRoot}</p> : null}
            <p className="break-all font-mono text-xs">
              {toolName} {args}
            </p>
            <p className="whitespace-pre-wrap">{reason}</p>
            <p className="text-muted-foreground">No answer denies in 2 minutes.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" onClick={() => onAnswer("allow")}>
              Allow once
            </Button>
            <Button type="button" variant="secondary" onClick={() => onAnswer("allow_session")}>
              Remember
            </Button>
            <Button type="button" variant="outline" onClick={() => onAnswer("deny")}>
              Deny
            </Button>
          </div>
        </div>
      </AlertDescription>
    </Alert>
  );
}
