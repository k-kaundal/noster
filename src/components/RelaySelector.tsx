import { Check, ChevronsUpDown, Wifi, Plus } from "lucide-react";
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
import { useState } from "react";
import { useAppContext } from "@/hooks/useAppContext";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useFollows } from "@/hooks/useFollows";

interface RelaySelectorProps {
  className?: string;
}

export function RelaySelector(props: RelaySelectorProps) {
  const { className } = props;
  const { config, updateConfig, presetRelays = [], syncAccountToRelays } = useAppContext();
  const { user, metadata } = useCurrentUser();
  const { followList } = useFollows(user?.pubkey ?? "");

  // Auto-follow public keys (in hex format)
  const autoFollowPubkeys = [
    "ccca7505ff5f19b90dc4b8cc1ec6760f6a1f9f4a7b7f4d4d0735a48b2ce8b3cb",
    "0e9dc3b18e5f7a3a6e258a4e2b5c803a47e3f98c7b81c2d345c3db008f3c2d43",
    "82c8c3b5097a7ed00bc4ae6d58c6d7eb8222f4b8f9962fa0c17a9b1d7738f1cb",
    "ed1c3f4d8c8c2c5f6d0f0e6b5f6d8c8c2c5f6d0f0e6b5f6d8c8c2c5f6d0f0e6b",
    "2f8c3b5097a7ed00bc4ae6d58c6d7eb8222f4b8f9962fa0c17a9b1d7738f1cb2",
  ];

  const selectedRelay = config.relayUrl;
  const setSelectedRelay = async (relay: string) => {
    // Always update the relay URL
    updateConfig((current) => ({ ...current, relayUrl: relay }));

    // Skip sync if no user is available
    if (!user?.pubkey) {
      console.log("No user available, relay updated but sync skipped");
      return;
    }

    // Use profile data from useProfile, fallback to defaults
    const profile = {
      name: metadata?.name || 'Steady Fox',
      about: metadata?.about || '',
      picture: metadata?.picture || '',
      lud16: metadata?.lud16 || '',
    };

    // Extract pubkeys from followList tags (kind 3 event)
    const existingContacts = followList?.tags
      ?.filter(tag => tag[0] === 'p')
      .map(tag => tag[1]) || [];

    // Combine existing follows with auto-follow pubkeys, ensuring uniqueness
    const contacts = Array.from(new Set([...existingContacts, ...autoFollowPubkeys]));

    try {
      await syncAccountToRelays(user.signer, profile, contacts);
      console.log(`Synced profile and follows to ${relay}`);
    } catch (error) {
      console.error(`Failed to sync to ${relay}:`, error);
    }
  };

  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");

  const selectedOption = presetRelays.find((option) => option.url === selectedRelay);

  const normalizeRelayUrl = (url: string): string => {
    const trimmed = url.trim();
    if (!trimmed) return trimmed;
    if (trimmed.includes('://')) return trimmed;
    return `wss://${trimmed}`;
  };

  const handleAddCustomRelay = (url: string) => {
    setSelectedRelay(normalizeRelayUrl(url));
    setOpen(false);
    setInputValue("");
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
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0">
        <Command>
          <CommandInput 
            placeholder="Search relays or type URL..." 
            value={inputValue}
            onValueChange={setInputValue}
          />
          <CommandList>
            <CommandEmpty>
              {inputValue && isValidRelayInput(inputValue) ? (
                <CommandItem
                  onSelect={() => handleAddCustomRelay(inputValue)}
                  className="cursor-pointer"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  <div className="flex flex-col">
                    <span className="font-medium">Add custom relay</span>
                    <span className="text-xs text-muted-foreground">
                      {normalizeRelayUrl(inputValue)}
                    </span>
                  </div>
                </CommandItem>
              ) : (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  {inputValue ? "Invalid relay URL" : "No relay found."}
                </div>
              )}
            </CommandEmpty>
            <CommandGroup>
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
                    onSelect={(currentValue) => {
                      setSelectedRelay(normalizeRelayUrl(currentValue));
                      setOpen(false);
                      setInputValue("");
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        selectedRelay === option.url ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <div className="flex flex-col">
                      <span className="font-medium">{option.name}</span>
                      <span className="text-xs text-muted-foreground">{option.url}</span>
                    </div>
                  </CommandItem>
                ))}
              {inputValue && isValidRelayInput(inputValue) && (
                <CommandItem
                  onSelect={() => handleAddCustomRelay(inputValue)}
                  className="cursor-pointer border-t"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  <div className="flex flex-col">
                    <span className="font-medium">Add custom relay</span>
                    <span className="text-xs text-muted-foreground">
                      {normalizeRelayUrl(inputValue)}
                    </span>
                  </div>
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}