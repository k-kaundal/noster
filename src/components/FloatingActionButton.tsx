import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { Button } from '@/components/ui/button';
import { PenTool, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export function FloatingActionButton() {
  const { user } = useCurrentUser();
  const [isExpanded, setIsExpanded] = useState(false);

  if (!user) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <div className="relative">
        {/* Expanded menu */}
        {isExpanded && (
          <div className="absolute bottom-16 right-0 flex flex-col space-y-3 animate-slide-up">
            <Link to="/compose">
              <Button
                size="lg"
                className="rounded-full shadow-lg hover-lift bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
              >
                <PenTool className="h-5 w-5 mr-2" />
                New Post
              </Button>
            </Link>
          </div>
        )}

        {/* Main FAB */}
        <Button
          size="lg"
          onClick={() => setIsExpanded(!isExpanded)}
          className={cn(
            "rounded-full h-14 w-14 shadow-lg hover-lift transition-all duration-300",
            "bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700",
            isExpanded && "rotate-45"
          )}
        >
          {isExpanded ? (
            <X className="h-6 w-6" />
          ) : (
            <Plus className="h-6 w-6" />
          )}
        </Button>
      </div>
    </div>
  );
}