import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronsUpDown, Server, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { useRelays } from "@/hooks/useRelays";
import { useRelayHealth } from "@/hooks/useRelayHealth";
import { isValidRelayUrl, relayDisplayName } from "@/lib/relay";
import { cn } from "@/lib/utils";

interface RelaySelectorProps {
  className?: string;
}

/**
 * Compact relay switcher for the header and menus. It picks the primary relay
 * and can add one inline; the full read/write, health and NIP-65 controls live
 * on the relays page.
 */
export function RelaySelector({ className }: RelaySelectorProps) {
  const {
    relays,
    primaryUrl,
    readUrls,
    suggestions,
    setPrimary,
    addRelay,
  } = useRelays();
  const { health } = useRelayHealth(relays.map((relay) => relay.url));

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const canAddTyped = isValidRelayUrl(search) &&
    !relays.some((relay) => relay.url === search.trim());

  const onlineCount = relays.filter(
    (relay) => health[relay.url]?.status === "online"
  ).length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("justify-between font-normal", className)}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Server className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{relayDisplayName(primaryUrl)}</span>
          </span>
          <span className="ml-2 flex shrink-0 items-center gap-1.5">
            {relays.length > 1 && (
              <span className="text-xs tabular-nums text-muted-foreground">
                +{relays.length - 1}
              </span>
            )}
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-72 p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Search or add wss://…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              {canAddTyped ? (
                <button
                  type="button"
                  className="w-full px-2 py-1.5 text-sm text-primary hover:underline"
                  onClick={() => {
                    addRelay(search);
                    setSearch("");
                  }}
                >
                  Add “{relayDisplayName(search)}”
                </button>
              ) : (
                <span className="text-sm text-muted-foreground">
                  No relay found.
                </span>
              )}
            </CommandEmpty>

            <CommandGroup heading="Your relays">
              {relays.map((relay) => {
                const status = health[relay.url]?.status;
                return (
                  <CommandItem
                    key={relay.url}
                    value={relay.url}
                    onSelect={() => {
                      setPrimary(relay.url);
                      setOpen(false);
                    }}
                    className="gap-2"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        status === "online"
                          ? "bg-success"
                          : status === "offline"
                            ? "bg-destructive"
                            : "bg-muted-foreground/40"
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {relayDisplayName(relay.url)}
                    </span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {relay.read && relay.write
                        ? "rw"
                        : relay.read
                          ? "r"
                          : relay.write
                            ? "w"
                            : "off"}
                    </span>
                    {relay.url === primaryUrl && (
                      <Check className="h-4 w-4 shrink-0 text-primary" />
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>

            {suggestions.length > 0 && (
              <CommandGroup heading="Add a relay">
                {suggestions.slice(0, 6).map((preset) => (
                  <CommandItem
                    key={preset.url}
                    value={preset.url}
                    onSelect={() => addRelay(preset.url)}
                    className="gap-2 text-muted-foreground"
                  >
                    <span className="min-w-0 flex-1 truncate">{preset.name}</span>
                    <span className="shrink-0 text-xs">Add</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>

        <Separator />

        <div className="flex items-center justify-between gap-2 p-2">
          <span className="pl-1 text-xs text-muted-foreground">
            Reading from {readUrls.length} · {onlineCount} online
          </span>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setOpen(false)}
          >
            <Link to="/relays">
              <Settings2 className="mr-1.5 h-3.5 w-3.5" />
              Manage
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
