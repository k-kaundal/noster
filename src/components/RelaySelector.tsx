import { Check, ChevronsUpDown, Wifi, Plus, Loader2, AlertCircle, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
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
import { useState, useEffect } from "react";
import { useAppContext } from "@/hooks/useAppContext";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useFollows } from "@/hooks/useFollows";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Relay, Event, SimplePool } from "nostr-tools";

interface RelayOption {
  url: string;
  name: string;
  active?: boolean;
}

interface RelaySelectorProps {
  className?: string;
}

export function RelaySelector(props: RelaySelectorProps) {
  const { className } = props;
  const { config, updateConfig, presetRelays = [], syncAccountToRelays } = useAppContext();
  const { user, metadata } = useCurrentUser();
  const { followList } = useFollows(user?.pubkey ?? "");
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [customRelays, setCustomRelays] = useState<RelayOption[]>([]);
  const [relayStatus, setRelayStatus] = useState<Record<string, { status: 'checking' | 'online' | 'offline' }>>({});
  const selectedRelay = config.relayUrl;
  const pool = new SimplePool();
  const knownRelays = ["wss://relay.damus.io", "wss://nostr-pub.wellorder.net"];

  const allRelays = [...presetRelays, ...customRelays];

  // Initialize user's relay list with presetRelays on mount if user is authenticated
  useEffect(() => {
    const initializeRelayList = async () => {
      if (user?.pubkey && user?.signer && presetRelays.length > 0) {
        const existingRelays = allRelays.map(r => r.url);
        if (!existingRelays.length || !existingRelays.some(url => presetRelays.some(pr => pr.url === url))) {
          await publishRelayList(presetRelays.map(r => r.url));
          // Pass user.signer to syncAccountToRelays
          await syncAccountToRelays(user.signer);
        }
      }
    };
    initializeRelayList();
  }, [user?.pubkey, user?.signer, presetRelays]);

  const setSelectedRelay = async (relay: string) => {
    updateConfig((current) => ({ ...current, relayUrl: relay }));
    const relays = [...new Set([...presetRelays.map(r => r.url), ...customRelays.map(r => r.url), relay])];
    await publishRelayList(relays);
    if (user) {
        await syncAccountToRelays(user.signer);
    }
  };

  // Publish NIP-65 relay list (kind 10002)
  const publishRelayList = async (relays: string[]) => {
    if (!user?.pubkey || !user?.signer) {
      console.log("No user or signer available, skipping relay list publish");
      return;
    }

    const tags = relays.map(url => ["r", url]);
    const event: Event = {
      kind: 10002,
      pubkey: user.pubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: "",
      id: "",
      sig: ""
    };

    try {
      const signedEvent = await user.signer.signEvent(event);
      await Promise.all(knownRelays.map(relay => pool.publish([relay], signedEvent)));
      console.log("Published NIP-65 relay list to known relays:", relays);
    } catch (error) {
      console.error("Failed to publish NIP-65 relay list:", error);
    }
  };

  // Check relay status
  const checkRelayStatus = async (relayUrl: string) => {
    setRelayStatus((prev) => ({ ...prev, [relayUrl]: { status: 'checking' } }));
    try {
      const relay = await Relay.connect(relayUrl);
      setRelayStatus((prev) => ({ ...prev, [relayUrl]: { status: 'online' } }));
      await relay.close();
    } catch (error) {
      setRelayStatus((prev) => ({ ...prev, [relayUrl]: { status: 'offline' } }));
      console.error(`Failed to connect to ${relayUrl}:`, error);
    }
  };

  // Check status for all relays on mount
  useEffect(() => {
    allRelays.forEach((relay) => {
      if (!relayStatus[relay.url]) {
        checkRelayStatus(relay.url);
      }
    });
  }, [allRelays.map(r => r.url).join(',')]);

  const normalizeRelayUrl = (url: string): string => {
    const trimmed = url.trim();
    if (!trimmed) return trimmed;
    if (trimmed.includes('://')) return trimmed;
    return `wss://${trimmed}`;
  };

  const isValidRelayInput = (value: string): boolean => {
    const trimmed = value.trim();
    if (!trimmed) return false;
    const normalized = normalizeRelayUrl(trimmed);
    try {
      new URL(normalized);
      return true;
    } catch {
      return false;
    }
  };

  const deriveRelayName = (url: string): string => {
    const normalized = normalizeRelayUrl(url);
    try {
      const parsed = new URL(normalized);
      return parsed.hostname.replace(/^wss?:\/\//, '');
    } catch {
      return url;
    }
  };

  const handleAddCustomRelay = async () => {
    const normalizedUrl = normalizeRelayUrl(inputValue);
    if (!isValidRelayInput(inputValue)) return;
    const name = deriveRelayName(inputValue);
    const newRelay: RelayOption = { url: normalizedUrl, name };
    setCustomRelays((prev) => [...prev, newRelay]);
    await checkRelayStatus(normalizedUrl);
    await setSelectedRelay(normalizedUrl);
    setInputValue("");
    setOpen(false);
  };

  const handleRemoveCustomRelay = async (url: string) => {
    setCustomRelays((prev) => prev.filter((relay) => relay.url !== url));
    if (selectedRelay === url) {
      setSelectedRelay(presetRelays[0]?.url || "");
    }
    // Ensure presetRelays are included when publishing updated relay list
    const relays = [...presetRelays.map(r => r.url), ...customRelays.filter(r => r.url !== url).map(r => r.url)];
    await publishRelayList(relays);
    if(user)
    await syncAccountToRelays(user.signer);
  };

  const selectedOption = allRelays.find((option) => option.url === selectedRelay);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("justify-between", className)}
        >
          <div className="flex items-center gap-2">
            <Wifi className="h-4 w-4" />
            <span className="truncate">
              {selectedOption 
                ? selectedOption.name 
                : selectedRelay 
                  ? selectedRelay.replace(/^wss?:\/\//, '')
                  : "Select relay..."
              }
            </span>
            {selectedRelay && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      {relayStatus[selectedRelay]?.status === 'checking' && (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      )}
                      {relayStatus[selectedRelay]?.status === 'online' && (
                        <Check className="h-4 w-4 text-green-500" />
                      )}
                      {relayStatus[selectedRelay]?.status === 'offline' && (
                        <AlertCircle className="h-4 w-4 text-red-500" />
                      )}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {relayStatus[selectedRelay]?.status === 'checking' && "Checking relay status..."}
                    {relayStatus[selectedRelay]?.status === 'online' && "Relay is online"}
                    {relayStatus[selectedRelay]?.status === 'offline' && "Relay is offline"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0">
        <Command>
          <CommandInput 
            placeholder="Search relays or type URL (e.g., wss://your-relay.com)..." 
            value={inputValue}
            onValueChange={setInputValue}
          />
          <CommandList>
            <CommandEmpty>
              {inputValue && isValidRelayInput(inputValue) ? (
                <CommandItem
                  className="cursor-pointer"
                >
                  <Button
                    variant="ghost"
                    className="w-full flex items-center justify-start"
                    onClick={handleAddCustomRelay}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    <div className="flex flex-col">
                      <span className="font-medium">Add custom relay: {deriveRelayName(inputValue)}</span>
                      <span className="text-xs text-muted-foreground">
                        {normalizeRelayUrl(inputValue)}
                      </span>
                    </div>
                  </Button>
                </CommandItem>
              ) : (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  {inputValue && !isValidRelayInput(inputValue) 
                    ? "Invalid relay URL" 
                    : "Enter a valid relay URL to add."
                  }
                </div>
              )}
            </CommandEmpty>
            <CommandGroup heading="Preset Relays">
              {presetRelays
                .filter((option) => 
                  !inputValue || 
                  option.name.toLowerCase().includes(inputValue.toLowerCase()) ||
                  option.url.toLowerCase().includes(inputValue.toLowerCase())
                )
                .map((option) => (
                  <CommandItem
                    key={option.url}
                    value={option.url}
                    onSelect={() => {
                      setSelectedRelay(normalizeRelayUrl(option.url));
                      setOpen(false);
                      setInputValue("");
                    }}
                  >
                    <div className="flex items-center w-full">
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          selectedRelay === option.url ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <div className="flex flex-col flex-1">
                        <span className="font-medium">{option.name}</span>
                        <span className="text-xs text-muted-foreground">{option.url}</span>
                      </div>
                      {relayStatus[option.url]?.status === 'checking' && (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      )}
                      {relayStatus[option.url]?.status === 'online' && (
                        <Check className="h-4 w-4 text-green-500" />
                      )}
                      {relayStatus[option.url]?.status === 'offline' && (
                        <AlertCircle className="h-4 w-4 text-red-500" />
                      )}
                    </div>
                  </CommandItem>
                ))}
            </CommandGroup>
            {customRelays.length > 0 && (
              <CommandGroup heading="Custom Relays">
                {customRelays
                  .filter((option) => 
                    !inputValue || 
                    option.name.toLowerCase().includes(inputValue.toLowerCase()) ||
                    option.url.toLowerCase().includes(inputValue.toLowerCase())
                  )
                  .map((option) => (
                    <CommandItem
                      key={option.url}
                      value={option.url}
                      onSelect={() => {
                        setSelectedRelay(normalizeRelayUrl(option.url));
                        setOpen(false);
                        setInputValue("");
                      }}
                    >
                      <div className="flex items-center w-full">
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            selectedRelay === option.url ? "opacity-100" : "opacity-0"
                          )}
                        />
                        <div className="flex flex-col flex-1">
                          <span className="font-medium">{option.name}</span>
                          <span className="text-xs text-muted-foreground">{option.url}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="p-1"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveCustomRelay(option.url);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                        {relayStatus[option.url]?.status === 'checking' && (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        )}
                        {relayStatus[option.url]?.status === 'online' && (
                          <Check className="h-4 w-4 text-green-500" />
                        )}
                        {relayStatus[option.url]?.status === 'offline' && (
                          <AlertCircle className="h-4 w-4 text-red-500" />
                        )}
                      </div>
                    </CommandItem>
                  ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}