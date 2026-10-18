import { IoAdd } from 'react-icons/io5';

const PluginButton = ({ onOpenPlugins }) => {
  return (
    <div className="flex shrink-0 items-center gap-4 px-4 py-2">
      <button
        onClick={() => onOpenPlugins?.()}
        className="flex items-center gap-3 px-4 py-2 text-sm font-medium 
                   border border-transparent rounded-lg 
                   hover:border-(--fill-1) hover:bg-(--fill-1)/10 
                   transition-colors duration-200"
      >
        <IoAdd className="h-4 w-4" />
        <span>Add PlugIns</span>
      </button>
    </div>
  );
};

export default PluginButton;